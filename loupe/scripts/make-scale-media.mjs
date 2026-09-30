#!/usr/bin/env node
// Generates a large synthetic library for performance testing: unique JPEGs
// with EXIF capture dates spread over ten years in Year/Month Event folders,
// plus short videos.
//
// Usage: node scripts/make-scale-media.mjs [count=15000] [videos=200] [out=test-data/scale]

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { cpus } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const EVENTS = ['Beach Day', 'Birthday', 'Hiking', 'Fishing Trip', 'Family Dinner', 'City Walk', 'Garden', 'Concert', 'Road Trip', 'Snow', 'Museum', 'Frogs', 'Newts', 'Chess Club', 'Market']
const CAMERAS = [['Canon', 'Canon EOS R6'], ['NIKON CORPORATION', 'NIKON Z 6II'], ['SONY', 'ILCE-7M4'], ['Apple', 'iPhone 15 Pro'], ['Google', 'Pixel 8'], ['FUJIFILM', 'X-T5']]

function plan(count) {
  const r = rng(42)
  const items = []
  const start = new Date(2016, 0, 1).getTime()
  const span = new Date(2026, 8, 1).getTime() - start
  // Group into events of 20–120 photos.
  let i = 0
  while (i < count) {
    const n = Math.min(count - i, 20 + Math.floor(r() * 100))
    const t0 = start + Math.floor(r() * span)
    const d = new Date(t0)
    const event = EVENTS[Math.floor(r() * EVENTS.length)]
    const cam = CAMERAS[Math.floor(r() * CAMERAS.length)]
    const folder = join(String(d.getFullYear()), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} ${event}`)
    const portraitBias = r()
    for (let k = 0; k < n; k++, i++) {
      items.push({ i, folder, t: t0 + k * (20000 + Math.floor(r() * 400000)), cam, portrait: r() < portraitBias * 0.5, seed: 1000 + i })
    }
  }
  return items
}

async function render(item, out, sharp) {
  const r = rng(item.seed)
  const w = item.portrait ? 1200 : 1600
  const h = item.portrait ? 1600 : 1200
  const hue = Math.floor(r() * 360)
  const circles = Array.from({ length: 6 + Math.floor(r() * 8) }, () => {
    const cx = Math.floor(r() * w), cy = Math.floor(r() * h), rad = Math.floor(40 + r() * 260)
    return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="hsl(${Math.floor(r() * 360)},${50 + Math.floor(r() * 40)}%,${35 + Math.floor(r() * 40)}%)" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,28%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${circles}
    <text x="40" y="${h - 50}" font-size="56" font-family="sans-serif" fill="white" opacity="0.85">#${item.i}</text></svg>`
  const d = new Date(item.t)
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  const file = join(out, item.folder, `IMG_${String(item.i).padStart(5, '0')}.jpg`)
  mkdirSync(dirname(file), { recursive: true })
  await sharp(Buffer.from(svg), { density: 72 })
    .jpeg({ quality: 82 })
    .withExif({ IFD0: { Make: item.cam[0], Model: item.cam[1], DateTime: stamp }, IFD2: { DateTimeOriginal: stamp, DateTimeDigitized: stamp } })
    .toFile(file)
}

if (isMainThread) {
  const count = parseInt(process.argv[2] ?? '15000', 10)
  const videos = parseInt(process.argv[3] ?? '200', 10)
  const out = resolve(process.argv[4] ?? 'test-data/scale')
  mkdirSync(out, { recursive: true })
  const items = plan(count)
  const n = Math.max(1, cpus().length)
  const t0 = Date.now()
  let done = 0
  await Promise.all(
    Array.from({ length: n }, (_, w) => new Promise((res, rej) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { items: items.filter((_, k) => k % n === w), out } })
      worker.on('message', () => {
        done++
        if (done % 1000 === 0) console.log(`${done}/${count} images (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
      })
      worker.on('error', rej)
      worker.on('exit', res)
    }))
  )
  console.log(`images done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const ffmpeg = require('ffmpeg-static')
  const vdir = join(out, 'Videos')
  mkdirSync(vdir, { recursive: true })
  for (let v = 0; v < videos; v++) {
    const file = join(vdir, `VID_${String(v).padStart(4, '0')}.mp4`)
    if (existsSync(file)) continue
    const dur = 2 + (v % 5)
    const d = new Date(2017 + (v % 9), v % 12, 1 + (v % 27), 12, 0, 0)
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=${dur}`, '-f', 'lavfi', '-i', `sine=frequency=${200 + v * 7}:duration=${dur}`,
      '-vf', `hue=h=${(v * 37) % 360}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-metadata', `creation_time=${d.toISOString()}`, '-movflags', '+faststart', file])
  }
  console.log(`videos done; total ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  writeFileSync(join(out, '.generated'), String(Date.now()))
} else {
  const sharp = require('sharp')
  sharp.concurrency(1)
  const { items, out } = workerData
  for (const it of items) {
    await render(it, out, sharp)
    parentPort.postMessage(1)
  }
}
