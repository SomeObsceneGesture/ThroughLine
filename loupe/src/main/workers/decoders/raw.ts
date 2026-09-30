// Camera RAW support via the JPEG previews that virtually every RAW format
// embeds (CR2/CR3/NEF/ARW/DNG/ORF/RW2/RAF/PEF...). We scan the file for JPEG
// streams, validate each by walking its marker segments, and keep the largest
// baseline/progressive one. Lossless-JPEG sensor data (SOF3) is ignored.

export interface EmbeddedJpeg {
  start: number
  end: number
  width: number
  height: number
}

const SOF_OK = new Set([0xc0, 0xc1, 0xc2])

function parseJpegAt(buf: Buffer, start: number): EmbeddedJpeg | null {
  let p = start + 2
  let width = 0
  let height = 0
  let sofOk = false
  let seenSos = false
  const n = buf.length
  while (p + 3 < n) {
    if (buf[p] !== 0xff) return null
    const marker = buf[p + 1]
    if (marker === 0xff) { p++; continue }
    if (marker === 0xd9) {
      if (!seenSos || !sofOk || !width || !height) return null
      return { start, end: p + 2, width, height }
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue }
    if (marker === 0xd8) return null
    const len = buf.readUInt16BE(p + 2)
    if (len < 2 || p + 2 + len > n) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (!SOF_OK.has(marker)) return null
      height = buf.readUInt16BE(p + 5)
      width = buf.readUInt16BE(p + 7)
      sofOk = true
    }
    p += 2 + len
    if (marker === 0xda) {
      seenSos = true
      // Skip entropy-coded data up to the next real marker.
      for (;;) {
        const ff = buf.indexOf(0xff, p)
        if (ff < 0 || ff + 1 >= n) return null
        const next = buf[ff + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { p = ff + 2; continue }
        if (next === 0xff) { p = ff + 1; continue }
        p = ff
        break
      }
    }
  }
  return null
}

const SOI = Buffer.from([0xff, 0xd8, 0xff])

export function findEmbeddedJpegs(buf: Buffer): EmbeddedJpeg[] {
  const found: EmbeddedJpeg[] = []
  let pos = 0
  while (pos < buf.length) {
    const i = buf.indexOf(SOI, pos)
    if (i < 0) break
    const r = parseJpegAt(buf, i)
    if (r) {
      found.push(r)
      pos = r.end
    } else {
      pos = i + 2
    }
  }
  return found
}

export function largestEmbeddedJpeg(buf: Buffer): Buffer | null {
  let best: EmbeddedJpeg | null = null
  for (const j of findEmbeddedJpegs(buf)) {
    if (!best || j.width * j.height > best.width * best.height) best = j
  }
  // Tiny previews (e.g. 160x120 thumbnails) are not worth showing full screen,
  // but they still beat nothing.
  return best ? buf.subarray(best.start, best.end) : null
}
