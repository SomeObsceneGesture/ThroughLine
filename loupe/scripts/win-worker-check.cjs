// Runs the packaged Windows build's media worker over a folder of test media,
// for checking the Windows native pipeline (libvips, libheif, ffmpeg, ffprobe)
// from Linux under Wine:
//
//   ELECTRON_RUN_AS_NODE=1 wine dist/win-unpacked/Loupe.exe scripts/win-worker-check.cjs <media> <outDir> <log.json>
//
// (Paths as Windows paths, e.g. Z:\home\...). Output goes to a JSON file
// because Wine can't hand Node a usable stdout pipe.
const { Worker } = require('node:worker_threads')
const { readdirSync, statSync, mkdirSync, writeFileSync, existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const [media, outDir, logFile] = process.argv.slice(2)
const resources = path.join(path.dirname(process.execPath), 'resources')
const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules')
const ffmpegPath = path.join(unpacked, 'ffmpeg-static', 'ffmpeg.exe')
const ffprobePath = path.join(unpacked, '@ffprobe-installer', 'win32-x64', 'ffprobe.exe')
const report = { ffmpeg: existsSync(ffmpegPath), ffprobe: existsSync(ffprobePath), files: [], previews: [], converts: [], other: {} }
const save = () => writeFileSync(logFile, JSON.stringify(report, null, 1))

const PHOTOS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'heic', 'heif', 'avif', 'svg', 'nef', 'cr2', 'cr3', 'dng', 'arw'])
const VIDEOS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'])
const files = []
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else {
      const ext = path.extname(n).slice(1).toLowerCase()
      const kind = PHOTOS.has(ext) ? 'photo' : VIDEOS.has(ext) ? 'video' : null
      if (kind) files.push({ path: p, size: s.size, ext, kind })
    }
  }
}

;(async () => {
  try {
    walk(media)
    for (const d of ['thumbs', 'previews', 'converted']) mkdirSync(path.join(outDir, d), { recursive: true })
    const worker = new Worker(path.join(resources, 'app.asar', 'out', 'main', 'media-worker.js'), { workerData: { ffmpegPath, ffprobePath } })
    let next = 1
    const pending = new Map()
    worker.on('message', (m) => {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.ok ? p.resolve(m.result) : p.reject(Object.assign(new Error(m.error), { detail: m.detail }))
    })
    worker.on('error', (e) => { report.workerError = String(e && e.stack || e); save() })
    const run = (type, payload) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, payload }) })
    const rel = (p) => path.relative(media, p)

    const probes = await run('probe', { files })
    const probed = new Map(probes.map((p) => [p.path, p]))
    let i = 0
    for (const f of files) {
      const entry = { file: rel(f.path), probe: probed.get(f.path) }
      try {
        const r = await run('process', { path: f.path, ext: f.ext, kind: f.kind, thumbPath: path.join(outDir, 'thumbs', `${++i}.webp`), thumbSize: 512, quality: 76 })
        entry.ok = true
        entry.size = `${r.width}x${r.height}`
        entry.format = r.metadata && r.metadata.format
        entry.takenAt = r.takenAt ? new Date(r.takenAt).toISOString() : null
        entry.duration = r.duration || null
        entry.thumb = existsSync(path.join(outDir, 'thumbs', `${i}.webp`))
      } catch (e) {
        entry.ok = false
        entry.error = e.message
      }
      report.files.push(entry)
      save()
    }
    for (const f of files.filter((f) => ['heic', 'heif', 'nef', 'cr2', 'dng', 'tif', 'tiff', 'bmp'].includes(f.ext))) {
      try {
        const r = await run('preview', { path: f.path, ext: f.ext, outPath: path.join(outDir, 'previews', path.basename(f.path) + '.jpg'), maxSize: 3072 })
        report.previews.push({ file: rel(f.path), ok: true, size: `${r.width}x${r.height}` })
      } catch (e) {
        report.previews.push({ file: rel(f.path), ok: false, error: e.message })
      }
    }
    const heic = files.find((f) => f.ext === 'heic')
    if (heic) {
      for (const format of ['jpeg', 'png', 'webp', 'avif']) {
        try {
          const r = await run('convert', { input: heic.path, ext: 'heic', output: path.join(outDir, 'converted', `heic.${format}`), format, quality: 85, resize: 'long', resizeValue: 1600, keepMetadata: true, stripLocation: false, rotation: 0 })
          report.converts.push({ format, ok: true, size: `${r.width}x${r.height}`, bytes: r.bytes })
        } catch (e) {
          report.converts.push({ format, ok: false, error: e.message })
        }
      }
    }
    const video = files.find((f) => f.kind === 'video' && probed.get(f.path) && probed.get(f.path).duration > 5)
    if (video) {
      try {
        report.other.storyboard = await run('storyboard', { path: video.path, outPath: path.join(outDir, 'storyboard.jpg'), duration: probed.get(video.path).duration, aspect: 16 / 9 })
      } catch (e) {
        report.other.storyboard = { error: e.message }
      }
    }
    report.other.hash = await run('hash', { path: files[0].path }).catch((e) => ({ error: e.message }))
    // Same ffmpeg arguments the app uses to make unplayable videos playable.
    const avi = files.find((f) => f.ext === 'avi')
    if (avi) {
      const out = path.join(outDir, 'transcoded.mp4')
      const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', avi.path, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', "scale='min(3840,iw)':-2", '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
      report.other.transcode = { status: r.status, ok: r.status === 0 && existsSync(out), stderr: String(r.stderr || '').slice(0, 300) }
    }
    report.done = true
    save()
    await worker.terminate()
  } catch (e) {
    report.fatal = String(e && e.stack || e)
    save()
  }
})()
