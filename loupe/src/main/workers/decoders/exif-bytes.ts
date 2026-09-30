// Byte-level EXIF helpers:
//  - pull the raw EXIF (TIFF) block out of a HEIF/HEIC container
//  - reset the orientation tag (pixels are already rotated when we re-encode)
//  - splice an EXIF APP1 segment into a freshly encoded JPEG

interface Box {
  type: string
  start: number
  payload: number
  end: number
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let p = start
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    let header = 8
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8))
      header = 16
    } else if (size === 0) size = end - p
    if (size < header || p + size > end + 8) return
    yield { type, start: p, payload: p + header, end: Math.min(end, p + size) }
    p += size
  }
}

function readN(buf: Buffer, p: number, n: number): number {
  if (n === 0) return 0
  if (n === 2) return buf.readUInt16BE(p)
  if (n === 4) return buf.readUInt32BE(p)
  if (n === 8) return Number(buf.readBigUInt64BE(p))
  return 0
}

/** Returns the TIFF-structured EXIF block of a HEIF file, or null. */
export function heifExif(buf: Buffer): Buffer | null {
  try {
    const meta = [...boxes(buf, 0, buf.length)].find((b) => b.type === 'meta')
    if (!meta) return null
    let exifId = -1
    let iloc: Box | undefined
    for (const b of boxes(buf, meta.payload + 4, meta.end)) {
      if (b.type === 'iinf') {
        const v = buf[b.payload]
        const start = b.payload + 4 + (v === 0 ? 2 : 4)
        for (const e of boxes(buf, start, b.end)) {
          if (e.type !== 'infe') continue
          const ev = buf[e.payload]
          if (ev < 2) continue
          const idSize = ev === 2 ? 2 : 4
          const id = readN(buf, e.payload + 4, idSize)
          const type = buf.toString('latin1', e.payload + 4 + idSize + 2, e.payload + 4 + idSize + 6)
          if (type === 'Exif') exifId = id
        }
      } else if (b.type === 'iloc') iloc = b
    }
    if (exifId < 0 || !iloc) return null
    let p = iloc.payload
    const version = buf[p]
    p += 4
    const offsetSize = buf[p] >> 4
    const lengthSize = buf[p] & 15
    const baseOffsetSize = buf[p + 1] >> 4
    const indexSize = version === 1 || version === 2 ? buf[p + 1] & 15 : 0
    p += 2
    const count = version < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p)
    p += version < 2 ? 2 : 4
    for (let i = 0; i < count; i++) {
      const id = version < 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p)
      p += version < 2 ? 2 : 4
      let method = 0
      if (version === 1 || version === 2) {
        method = buf.readUInt16BE(p) & 15
        p += 2
      }
      p += 2 // data_reference_index
      const base = readN(buf, p, baseOffsetSize)
      p += baseOffsetSize
      const extents = buf.readUInt16BE(p)
      p += 2
      const parts: Buffer[] = []
      for (let e = 0; e < extents; e++) {
        p += indexSize
        const off = readN(buf, p, offsetSize)
        p += offsetSize
        const len = readN(buf, p, lengthSize)
        p += lengthSize
        if (id === exifId && method === 0) parts.push(buf.subarray(base + off, base + off + len))
      }
      if (id === exifId) {
        const data = Buffer.concat(parts)
        if (data.length < 8) return null
        const tiffOffset = data.readUInt32BE(0)
        const tiff = data.subarray(4 + tiffOffset)
        const bo = tiff.toString('latin1', 0, 2)
        return bo === 'II' || bo === 'MM' ? Buffer.from(tiff) : null
      }
    }
  } catch {
    return null
  }
  return null
}

/** Set the Orientation tag (0x0112) in IFD0 of a TIFF/EXIF block to 1, in place. */
export function resetOrientation(tiff: Buffer): Buffer {
  try {
    const le = tiff.toString('latin1', 0, 2) === 'II'
    const u16 = (o: number): number => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
    const u32 = (o: number): number => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
    const ifd = u32(4)
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (u16(e) === 0x0112) {
        if (le) tiff.writeUInt16LE(1, e + 8)
        else tiff.writeUInt16BE(1, e + 8)
      }
    }
  } catch {
    /* leave untouched */
  }
  return tiff
}

/** Insert an EXIF APP1 segment right after SOI (and any JFIF APP0). */
export function insertJpegExif(jpeg: Buffer, tiff: Buffer): Buffer {
  const header = Buffer.from('Exif\0\0', 'latin1')
  const payloadLength = header.length + tiff.length + 2
  if (payloadLength > 0xffff) return jpeg
  const seg = Buffer.alloc(4)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg.writeUInt16BE(payloadLength, 2)
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4)
  // Drop any EXIF the encoder already wrote.
  let rest = jpeg.subarray(at)
  if (rest[0] === 0xff && rest[1] === 0xe1 && rest.toString('latin1', 4, 8) === 'Exif') {
    rest = rest.subarray(2 + rest.readUInt16BE(2))
  }
  return Buffer.concat([jpeg.subarray(0, at), seg, header, tiff, rest])
}

/**
 * Image size of a HEIF file from its 'ispe' properties (largest wins, which
 * is the primary/grid image), with 90°/270° 'irot' rotation applied.
 */
export function heifSize(buf: Buffer): { width: number; height: number } | null {
  try {
    const meta = [...boxes(buf, 0, buf.length)].find((b) => b.type === 'meta')
    if (!meta) return null
    let best: { width: number; height: number } | null = null
    let rotated = false
    for (const b of boxes(buf, meta.payload + 4, meta.end)) {
      if (b.type !== 'iprp') continue
      for (const c of boxes(buf, b.payload, b.end)) {
        if (c.type !== 'ipco') continue
        for (const prop of boxes(buf, c.payload, c.end)) {
          if (prop.type === 'ispe' && prop.payload + 12 <= prop.end) {
            const w = buf.readUInt32BE(prop.payload + 4)
            const h = buf.readUInt32BE(prop.payload + 8)
            if (!best || w * h > best.width * best.height) best = { width: w, height: h }
          } else if (prop.type === 'irot' && prop.payload < prop.end) {
            const angle = buf[prop.payload] & 3
            if (angle === 1 || angle === 3) rotated = true
          }
        }
      }
    }
    if (best && rotated) return { width: best.height, height: best.width }
    return best
  } catch {
    return null
  }
}
