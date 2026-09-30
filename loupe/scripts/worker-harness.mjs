// Exercises the built media worker (out/main/media-worker.js) directly in Node
// against test-data/varied: probe → process → preview → convert → storyboard.
import { Worker } from 'node:worker_threads'
import { readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
if (process.versions.electron && process.platform === 'linux' && process.env.LOUPE_NATIVE_SHARP !== '1') {
  // Same override the app applies (see src/main/sharp-preload.ts).
  const Module = require('node:module')
  const wasm = require('@img/sharp-wasm32/sharp.node')
  const shim = require.resolve(`@img/sharp-linux-${process.arch}/sharp.node`)
  Module._cache[shim] = { id: shim, filename: shim, loaded: true, exports: wasm, children: [], paths: [] }
}
const sharp = require('sharp')
const root = process.argv[2] ?? 'test-data/varied'
const out = 'test-data/harness-out'
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await sharp(join(root, 'Vacation 2026/Florida/Beach/IMG_2844.JPG')).resize(1600).avif({ quality: 60 }).toFile(join(root, 'Vacation 2026/Georgia/Atlanta/modern.avif'))

const worker = new Worker('./out/main/media-worker.js', {
  workerData: { ffmpegPath: require('ffmpeg-static'), ffprobePath: require('@ffprobe-installer/ffprobe').path }
})
let nextId = 1
const pending = new Map()
worker.on('message', (m) => { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(Object.assign(new Error(m.error), { detail: m.detail })) })
const run = (type, payload) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, payload }) })

const IMAGES = new Set(['jpg','jpeg','png','webp','gif','tif','tiff','bmp','heic','avif','svg','nef','cr2','dng'])
const VIDEOS = new Set(['mp4','mov','mkv','webm','avi'])
const files = []
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else { const ext = extname(n).slice(1).toLowerCase(); const kind = IMAGES.has(ext) ? 'photo' : VIDEOS.has(ext) ? 'video' : null; if (kind) files.push({ path: p, size: s.size, ext, kind }) } } }
walk(root)

let t = Date.now()
const probes = await run('probe', { files })
console.log(`probe: ${files.length} files in ${Date.now() - t}ms`)
for (const p of probes) console.log('  ', p.path.replace(root + '/', '').padEnd(48), p.error ?? `${p.width}x${p.height} o=${p.orientation ?? '-'} taken=${p.takenAt ? new Date(p.takenAt).toISOString() : '-'} dur=${p.duration?.toFixed?.(2) ?? '-'}`)

t = Date.now()
let i = 0
await Promise.all(files.map(async (f) => {
  const id = ++i
  try {
    const r = await run('process', { path: f.path, ext: f.ext, kind: f.kind, thumbPath: join(out, 'thumbs', `${id}-${f.path.split('/').pop()}.webp`), thumbSize: 512, quality: 76 })
    console.log('  ✓', f.path.replace(root + '/', '').padEnd(48), `${r.width}x${r.height}`, r.metadata.format, r.camera ?? '', r.takenAt ? new Date(r.takenAt).toISOString() : '', r.duration ? `${r.duration.toFixed(1)}s` : '', r.metadata.codec ?? '', r.phash, r.metadata.gps ? `gps ${r.metadata.gps.lat.toFixed(3)},${r.metadata.gps.lon.toFixed(3)}` : '')
  } catch (e) {
    console.log('  ✗', f.path.replace(root + '/', '').padEnd(48), e.message, '|', (e.detail ?? '').slice(0, 100))
  }
}))
console.log(`process: ${files.length} files in ${Date.now() - t}ms`)

for (const f of files.filter((f) => ['heic', 'nef', 'cr2', 'dng', 'tif', 'bmp'].includes(f.ext))) {
  try {
    const r = await run('preview', { path: f.path, ext: f.ext, outPath: join(out, 'previews', f.path.split('/').pop() + '.jpg'), maxSize: 3072 })
    console.log('  preview', f.path.split('/').pop(), `${r.width}x${r.height}`)
  } catch (e) { console.log('  preview ✗', f.path.split('/').pop(), e.message, e.detail) }
}

const heic = files.find((f) => f.ext === 'heic')
for (const format of ['jpeg', 'png', 'webp', 'avif', 'tiff']) {
  t = Date.now()
  const output = join(out, 'converted', `heic-to.${format}`)
  const r = await run('convert', { input: heic.path, ext: 'heic', output, format, quality: 85, resize: 'long', resizeValue: 2048, keepMetadata: true, stripLocation: false, rotation: 0 })
  const m = await sharp(output).metadata()
  console.log(`  convert heic→${format}: ${r.width}x${r.height} ${(r.bytes / 1024).toFixed(0)}KB exif=${m.exif ? m.exif.length : 0}B orient=${m.orientation ?? '-'} ${Date.now() - t}ms`)
}
const rotated = files.find((f) => f.path.endsWith('IMG_2842.JPG'))
const r2 = await run('convert', { input: rotated.path, ext: 'jpg', output: join(out, 'converted', 'rotated-keep.jpg'), format: 'jpeg', quality: 85, resize: 'original', resizeValue: 0, keepMetadata: true, stripLocation: false, rotation: 0 })
const m2 = await sharp(join(out, 'converted', 'rotated-keep.jpg')).metadata()
console.log(`  convert orient-6 jpeg keepMetadata: ${r2.width}x${r2.height} orient=${m2.orientation} exif=${m2.exif?.length}`)
const r3 = await run('convert', { input: rotated.path, ext: 'jpg', output: join(out, 'converted', 'rotated-strip.webp'), format: 'webp', quality: 80, resize: 'percent', resizeValue: 50, keepMetadata: true, stripLocation: true, rotation: 90 })
console.log(`  convert orient-6 → webp 50% + user rot 90 strip gps: ${r3.width}x${r3.height}`)

const vid = files.find((f) => f.path.endsWith('one-minute.mp4'))
t = Date.now()
const sb = await run('storyboard', { path: vid.path, outPath: join(out, 'storyboard.jpg'), duration: 60, aspect: 16 / 9 })
console.log('  storyboard', JSON.stringify(sb), `${Date.now() - t}ms`)
t = Date.now()
const h = await run('hash', { path: vid.path })
console.log('  full hash', h, `${Date.now() - t}ms`)
await worker.terminate()
