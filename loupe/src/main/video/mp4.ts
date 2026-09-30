// Fast, dependency-free MP4/MOV header reader used during import so videos get
// their real capture date and dimensions before ffprobe runs.

import type { FileHandle } from 'node:fs/promises'

export interface Mp4Info {
  creationTime?: number
  duration?: number
  width?: number
  height?: number
}

const MAC_EPOCH_OFFSET = 2082844800 // seconds between 1904-01-01 and 1970-01-01

interface Box {
  type: string
  start: number
  headerSize: number
  size: number
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    let headerSize = 8
    if (size === 1) {
      if (p + 16 > end) return
      size = Number(buf.readBigUInt64BE(p + 8))
      headerSize = 16
    } else if (size === 0) size = end - p
    if (size < headerSize) return
    yield { type, start: p, headerSize, size }
    p += size
  }
}

function parseMoov(buf: Buffer): Mp4Info {
  const info: Mp4Info = {}
  for (const b of boxes(buf, 0, buf.length)) {
    const payload = b.start + b.headerSize
    const end = Math.min(buf.length, b.start + b.size)
    if (b.type === 'mvhd' && payload + 32 <= end) {
      const version = buf[payload]
      let created: number, timescale: number, duration: number
      if (version === 1) {
        created = Number(buf.readBigUInt64BE(payload + 4))
        timescale = buf.readUInt32BE(payload + 20)
        duration = Number(buf.readBigUInt64BE(payload + 24))
      } else {
        created = buf.readUInt32BE(payload + 4)
        timescale = buf.readUInt32BE(payload + 12)
        duration = buf.readUInt32BE(payload + 16)
      }
      if (created > MAC_EPOCH_OFFSET + 315532800) info.creationTime = (created - MAC_EPOCH_OFFSET) * 1000
      if (timescale > 0) info.duration = duration / timescale
    } else if (b.type === 'trak' && info.width === undefined) {
      let isVideo = false
      let w = 0, h = 0, rot = 0
      for (const c of boxes(buf, payload, end)) {
        const cp = c.start + c.headerSize
        if (c.type === 'tkhd' && cp + 84 <= end) {
          const v = buf[cp]
          const mOff = v === 1 ? cp + 52 : cp + 40
          const wOff = v === 1 ? cp + 88 : cp + 76
          if (wOff + 8 <= end) {
            w = buf.readUInt32BE(wOff) / 65536
            h = buf.readUInt32BE(wOff + 4) / 65536
            const a = buf.readInt32BE(mOff) / 65536
            const bb = buf.readInt32BE(mOff + 4) / 65536
            rot = Math.round((Math.atan2(bb, a) * 180) / Math.PI)
          }
        } else if (c.type === 'mdia') {
          for (const d of boxes(buf, cp, Math.min(end, c.start + c.size))) {
            if (d.type === 'hdlr') {
              const dp = d.start + d.headerSize
              if (buf.toString('latin1', dp + 8, dp + 12) === 'vide') isVideo = true
            }
          }
        }
      }
      if (isVideo && w > 0 && h > 0) {
        const swap = Math.abs(rot) === 90 || Math.abs(rot) === 270
        info.width = Math.round(swap ? h : w)
        info.height = Math.round(swap ? w : h)
      }
    }
  }
  return info
}

export async function readMp4Info(fh: FileHandle, fileSize: number): Promise<Mp4Info | null> {
  const header = Buffer.alloc(16)
  let pos = 0
  for (let i = 0; i < 64 && pos + 8 <= fileSize; i++) {
    const { bytesRead } = await fh.read(header, 0, 16, pos)
    if (bytesRead < 8) return null
    let size = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    if (i === 0 && type !== 'ftyp' && type !== 'moov' && type !== 'wide' && type !== 'mdat' && type !== 'free') return null
    let headerSize = 8
    if (size === 1) {
      size = Number(header.readBigUInt64BE(8))
      headerSize = 16
    } else if (size === 0) size = fileSize - pos
    if (size < headerSize) return null
    if (type === 'moov') {
      const len = Math.min(size - headerSize, 48 * 1024 * 1024)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, pos + headerSize)
      return parseMoov(buf)
    }
    pos += size
  }
  return null
}
