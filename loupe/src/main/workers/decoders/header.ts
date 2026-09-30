// Dimensions (and the EXIF block) straight from the first bytes of common image
// formats, so imports don't need to invoke a full image decoder per file.

export interface HeaderInfo {
  width: number
  height: number
  /** Raw TIFF-structured EXIF (JPEG APP1 minus its "Exif\0\0" prefix), if fully inside the buffer. */
  exif?: Buffer
}

function jpeg(buf: Buffer): HeaderInfo | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let p = 2
  let exif: Buffer | undefined
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) return null
    const marker = buf[p + 1]
    if (marker === 0xff) { p++; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null
    const len = buf.readUInt16BE(p + 2)
    if (len < 2) return null
    if (marker === 0xe1 && !exif && p + 4 + len <= buf.length + 2 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') {
      const end = p + 2 + len
      if (end <= buf.length) exif = buf.subarray(p + 10, end)
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), exif }
    }
    p += 2 + len
  }
  return null
}

function png(buf: Buffer): HeaderInfo | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function gif(buf: Buffer): HeaderInfo | null {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'GIF') return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}

function webp(buf: Buffer): HeaderInfo | null {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('latin1', 12, 16)
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21)
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }
  }
  return null
}

export function headerInfo(buf: Buffer, ext: string): HeaderInfo | null {
  try {
    switch (ext) {
      case 'jpg': case 'jpeg': case 'jpe': case 'jfif': return jpeg(buf)
      case 'png': return png(buf)
      case 'gif': return gif(buf)
      case 'webp': return webp(buf)
      default: return null
    }
  } catch {
    return null
  }
}

/** EXIF orientation (tag 0x0112) from a TIFF-structured EXIF block. */
export function exifOrientation(tiff: Buffer): number | undefined {
  try {
    const le = tiff.toString('latin1', 0, 2) === 'II'
    const u16 = (o: number): number => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
    const u32 = (o: number): number => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
    const ifd = u32(4)
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (u16(e) === 0x0112) return u16(e + 8)
    }
  } catch {
    /* ignore */
  }
  return undefined
}
