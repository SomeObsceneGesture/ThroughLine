#!/usr/bin/env node
// Renders the Windows installer's welcome/finish sidebar (164×314, 24-bit BMP,
// as NSIS requires) from the app icon on the brand gradient.
// Usage: node scripts/make-installer-art.mjs
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = 164
const H = 314

const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#5b8dff"/><stop offset="1" stop-color="#2743b8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.3" r="0.6">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`)

const icon = await sharp(join(root, 'build', 'icon.png')).resize(104, 104).png().toBuffer()
const shadow = await sharp({ create: { width: 104, height: 104, channels: 4, background: { r: 11, g: 26, b: 92, alpha: 0.45 } } })
  .composite([{ input: icon, blend: 'dest-in' }])
  .blur(6)
  .png()
  .toBuffer()

const { data } = await sharp(background)
  .composite([
    { input: shadow, left: 30, top: 70 },
    { input: icon, left: 30, top: 62 }
  ])
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

// 24-bit bottom-up BMP; 164 × 3 = 492 bytes per row is already 4-byte aligned.
const rowBytes = W * 3
const pixels = Buffer.alloc(rowBytes * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const src = (y * W + x) * 3
    const dst = (H - 1 - y) * rowBytes + x * 3
    pixels[dst] = data[src + 2]
    pixels[dst + 1] = data[src + 1]
    pixels[dst + 2] = data[src]
  }
}
const header = Buffer.alloc(54)
header.write('BM', 0)
header.writeUInt32LE(54 + pixels.length, 2)
header.writeUInt32LE(54, 10)
header.writeUInt32LE(40, 14)
header.writeInt32LE(W, 18)
header.writeInt32LE(H, 22)
header.writeUInt16LE(1, 26)
header.writeUInt16LE(24, 28)
header.writeUInt32LE(pixels.length, 34)
header.writeInt32LE(2835, 38)
header.writeInt32LE(2835, 42)
writeFileSync(join(root, 'build', 'installerSidebar.bmp'), Buffer.concat([header, pixels]))
console.log('wrote build/installerSidebar.bmp')
