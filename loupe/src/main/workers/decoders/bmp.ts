// Minimal BMP decoder (libvips/sharp has no BMP loader). Handles 1/4/8/16/24/32
// bit images, BI_RGB, BI_BITFIELDS and RLE4/RLE8 compression, bottom-up and
// top-down rows. Returns straight RGBA.

export interface DecodedImage {
  width: number
  height: number
  data: Buffer
}

function maskInfo(mask: number): { shift: number; bits: number } {
  if (!mask) return { shift: 0, bits: 0 }
  let shift = 0
  while (((mask >>> shift) & 1) === 0) shift++
  let bits = 0
  while (((mask >>> (shift + bits)) & 1) === 1) bits++
  return { shift, bits }
}

function scale(v: number, bits: number): number {
  if (bits === 0) return 255
  if (bits >= 8) return v >>> (bits - 8)
  return Math.round((v * 255) / ((1 << bits) - 1))
}

export function decodeBmp(buf: Buffer): DecodedImage {
  if (buf.length < 26 || buf.toString('latin1', 0, 2) !== 'BM') throw new Error('Not a BMP file')
  const pixelOffset = buf.readUInt32LE(10)
  const headerSize = buf.readUInt32LE(14)
  let width: number, height: number, bpp: number, compression = 0, colorsUsed = 0
  let paletteEntrySize = 4
  if (headerSize === 12) {
    width = buf.readUInt16LE(18)
    height = buf.readInt16LE(20)
    bpp = buf.readUInt16LE(24)
    paletteEntrySize = 3
  } else {
    width = buf.readInt32LE(18)
    height = buf.readInt32LE(22)
    bpp = buf.readUInt16LE(28)
    compression = buf.readUInt32LE(30)
    colorsUsed = buf.readUInt32LE(46)
  }
  const topDown = height < 0
  height = Math.abs(height)
  if (width <= 0 || height <= 0 || width * height > 400_000_000) throw new Error('Invalid BMP dimensions')

  let rMask = 0, gMask = 0, bMask = 0, aMask = 0
  if (compression === 3 || compression === 6) {
    const at = headerSize >= 52 ? 14 + 40 : 14 + headerSize
    rMask = buf.readUInt32LE(at)
    gMask = buf.readUInt32LE(at + 4)
    bMask = buf.readUInt32LE(at + 8)
    if (headerSize >= 56 || compression === 6) aMask = buf.readUInt32LE(at + 12)
  } else if (bpp === 16) {
    rMask = 0x7c00; gMask = 0x03e0; bMask = 0x001f
  } else if (bpp === 32) {
    rMask = 0x00ff0000; gMask = 0x0000ff00; bMask = 0x000000ff
    if (headerSize >= 56) aMask = buf.readUInt32LE(14 + 52)
  }

  const palette: number[][] = []
  if (bpp <= 8) {
    const count = colorsUsed || 1 << bpp
    const start = 14 + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0)
    for (let i = 0; i < count; i++) {
      const p = start + i * paletteEntrySize
      if (p + 2 >= buf.length) break
      palette.push([buf[p + 2], buf[p + 1], buf[p]])
    }
  }

  const out = Buffer.alloc(width * height * 4)
  const setPx = (x: number, row: number, r: number, g: number, b: number, a = 255): void => {
    const y = topDown ? row : height - 1 - row
    if (x >= width || y < 0 || y >= height) return
    const o = (y * width + x) * 4
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
  }

  if (compression === 1 || compression === 2) {
    // RLE8 / RLE4. Rows are stored bottom-up.
    let p = pixelOffset, x = 0, row = 0
    const rle4 = compression === 2
    const put = (idx: number): void => {
      const c = palette[idx] ?? [0, 0, 0]
      setPx(x++, row, c[0], c[1], c[2])
    }
    while (p + 1 < buf.length && row < height) {
      const count = buf[p++], val = buf[p++]
      if (count > 0) {
        for (let i = 0; i < count; i++) put(rle4 ? (i & 1 ? val & 0x0f : val >> 4) : val)
      } else if (val === 0) { x = 0; row++ }
      else if (val === 1) break
      else if (val === 2) { x += buf[p++]; row += buf[p++] }
      else {
        const n = val
        if (rle4) {
          for (let i = 0; i < n; i++) {
            const byte = buf[p + (i >> 1)]
            put(i & 1 ? byte & 0x0f : byte >> 4)
          }
          const bytes = (n + 1) >> 1
          p += bytes + (bytes & 1)
        } else {
          for (let i = 0; i < n; i++) put(buf[p + i])
          p += n + (n & 1)
        }
      }
    }
    return { width, height, data: out }
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4
  const rm = maskInfo(rMask), gm = maskInfo(gMask), bm = maskInfo(bMask), am = maskInfo(aMask)
  let anyAlpha = false
  for (let row = 0; row < height; row++) {
    const base = pixelOffset + row * stride
    if (base >= buf.length) break
    for (let x = 0; x < width; x++) {
      if (bpp === 24) {
        const o = base + x * 3
        setPx(x, row, buf[o + 2], buf[o + 1], buf[o])
      } else if (bpp === 32 || bpp === 16) {
        const v = bpp === 32 ? buf.readUInt32LE(base + x * 4) : buf.readUInt16LE(base + x * 2)
        const a = am.bits ? scale((v & aMask) >>> am.shift, am.bits) : 255
        if (am.bits && a !== 0) anyAlpha = true
        setPx(x, row,
          scale((v & rMask) >>> rm.shift, rm.bits),
          scale((v & gMask) >>> gm.shift, gm.bits),
          scale((v & bMask) >>> bm.shift, bm.bits),
          a)
      } else {
        const bitPos = x * bpp
        const byte = buf[base + (bitPos >> 3)]
        const shift = 8 - bpp - (bitPos & 7)
        const idx = (byte >> shift) & ((1 << bpp) - 1)
        const c = palette[idx] ?? [0, 0, 0]
        setPx(x, row, c[0], c[1], c[2])
      }
    }
  }
  // Many 32-bit BMPs carry an all-zero alpha channel; treat those as opaque.
  if (am.bits && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255
  return { width, height, data: out }
}
