// Background worker (worker_threads). All CPU/IO-heavy media work happens
// here so the main process — and therefore the UI — never blocks:
//   probe      quick hash + header metadata during import
//   process    thumbnail, full metadata, perceptual hash
//   preview    large JPEG for formats the viewer can't show natively
//   hash       full content hash for duplicate verification
//   convert    image conversion
//   storyboard video scrub-preview sprite

import { parentPort, workerData } from 'node:worker_threads'
import { open, readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import sharp, { type Sharp, type SharpOptions, type Exif } from 'sharp'
import * as exifrNs from 'exifr'
import { decodeBmp } from './decoders/bmp'
import { largestEmbeddedJpeg } from './decoders/raw'
import { heifExif, heifSize, insertJpegExif, resetOrientation } from './decoders/exif-bytes'
import { ffprobe, extractFrame, makeStoryboard } from '../video/ffmpeg'
import { readMp4Info } from '../video/mp4'
import { SHARP_IMAGE, HEIF_IMAGE, RAW_IMAGE } from '@shared/formats'
import type { MediaKind, MediaMetadata, ConvertFormat } from '@shared/types'

const exifr = ((exifrNs as unknown as { default?: typeof exifrNs }).default ?? exifrNs) as typeof exifrNs

const { ffmpegPath, ffprobePath } = (workerData ?? {}) as { ffmpegPath: string | null; ffprobePath: string | null }

sharp.concurrency(1)
sharp.cache({ memory: 48, files: 0, items: 32 })

// ─── helpers ────────────────────────────────────────────────────────────────

type HeicDecode = (opts: { buffer: Buffer | Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>
let heicDecode: HeicDecode | null = null
async function decodeHeic(buffer: Buffer): Promise<{ width: number; height: number; data: Buffer }> {
  if (!heicDecode) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    heicDecode = require('heic-decode') as HeicDecode
  }
  const r = await heicDecode({ buffer })
  return { width: r.width, height: r.height, data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength) }
}

const MIN_DATE = Date.UTC(1971, 0, 1)
function validDate(d: unknown): number | undefined {
  if (d instanceof Date) {
    const t = d.getTime()
    if (isFinite(t) && t > MIN_DATE && t < Date.now() + 2 * 86_400_000) return t
  }
  if (typeof d === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(d)
    if (m) return validDate(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
  }
  return undefined
}

interface ExifData {
  Make?: string
  Model?: string
  LensModel?: string
  Lens?: string
  ISO?: number
  FNumber?: number
  ExposureTime?: number
  FocalLength?: number
  FocalLengthIn35mmFormat?: number
  Flash?: number
  Software?: string
  ColorSpace?: number
  DateTimeOriginal?: Date | string
  CreateDate?: Date | string
  DateTimeDigitized?: Date | string
  ModifyDate?: Date | string
  Orientation?: number
  ExifImageWidth?: number
  ExifImageHeight?: number
  ImageWidth?: number
  ImageHeight?: number
  latitude?: number
  longitude?: number
  GPSAltitude?: number
  Artist?: string
  Copyright?: string
}

const EXIF_OPTS = {
  tiff: true,
  exif: true,
  gps: true,
  ifd1: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  translateValues: false,
  reviveValues: true,
  sanitize: true,
  mergeOutput: true
}

async function readExif(input: Buffer | string): Promise<ExifData | null> {
  // sharp hands back EXIF with its APP1 "Exif\0\0" prefix; exifr wants raw TIFF.
  if (Buffer.isBuffer(input) && input.length > 6 && input.toString('latin1', 0, 6) === 'Exif\0\0') input = input.subarray(6)
  try {
    const r = (await exifr.parse(input, EXIF_OPTS)) as (ExifData & { errors?: unknown[] }) | undefined
    if (!r || (r.errors && Object.keys(r).length === 1)) return null
    return r
  } catch {
    return null
  }
}

/** EXIF for HEIF files via our own box parser (exifr's HEIC reader is unreliable). */
async function readHeifExif(buf: Buffer): Promise<ExifData | null> {
  const tiff = heifExif(buf)
  return tiff ? readExif(tiff) : readExif(buf)
}

function exifDate(e: ExifData | null): number | undefined {
  if (!e) return undefined
  return validDate(e.DateTimeOriginal) ?? validDate(e.CreateDate) ?? validDate(e.DateTimeDigitized)
}

function cleanStr(s?: string): string | undefined {
  const v = s?.replace(/\0/g, '').trim()
  return v ? v : undefined
}

function metadataFromExif(e: ExifData | null, format: string): { metadata: MediaMetadata; camera?: string } {
  const md: MediaMetadata = { format }
  if (!e) return { metadata: md }
  const make = cleanStr(e.Make)
  let model = cleanStr(e.Model)
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0])) {
    // "Canon Canon EOS R5" → "Canon EOS R5"
  } else if (make && model) model = `${make} ${model}`
  md.make = make
  md.model = model ?? make
  md.lens = cleanStr(e.LensModel) ?? cleanStr(e.Lens)
  if (typeof e.ISO === 'number') md.iso = e.ISO
  if (typeof e.FNumber === 'number') md.fNumber = Math.round(e.FNumber * 10) / 10
  if (typeof e.ExposureTime === 'number') md.exposureTime = e.ExposureTime
  if (typeof e.FocalLength === 'number') md.focalLength = Math.round(e.FocalLength * 10) / 10
  if (typeof e.FocalLengthIn35mmFormat === 'number') md.focalLength35 = e.FocalLengthIn35mmFormat
  if (typeof e.Flash === 'number') md.flash = e.Flash & 1 ? 'Fired' : 'Did not fire'
  md.software = cleanStr(e.Software)
  if (e.ColorSpace === 1) md.colorSpace = 'sRGB'
  else if (e.ColorSpace === 65535) md.colorSpace = 'Uncalibrated'
  if (typeof e.latitude === 'number' && typeof e.longitude === 'number' && isFinite(e.latitude) && isFinite(e.longitude) && !(e.latitude === 0 && e.longitude === 0)) {
    md.gps = { lat: e.latitude, lon: e.longitude, alt: typeof e.GPSAltitude === 'number' ? e.GPSAltitude : undefined }
  }
  return { metadata: md, camera: md.model }
}

function orientedDims(w: number, h: number, orientation?: number): [number, number] {
  return orientation && orientation >= 5 && orientation <= 8 ? [h, w] : [w, h]
}

async function dHash(image: Buffer): Promise<string> {
  const px = await sharp(image).greyscale().resize(9, 8, { fit: 'fill', kernel: 'linear' }).raw().toBuffer()
  let hex = ''
  for (let row = 0; row < 8; row++) {
    let byte = 0
    for (let col = 0; col < 8; col++) {
      const a = px[row * 9 + col], b = px[row * 9 + col + 1]
      byte = (byte << 1) | (a > b ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Apply an EXIF orientation value manually (used for RAW previews). */
function applyOrientation(img: Sharp, o: number): Sharp {
  switch (o) {
    case 2: return img.flop()
    case 3: return img.rotate(180)
    case 4: return img.flip()
    case 5: return img.rotate(90).flop()
    case 6: return img.rotate(90)
    case 7: return img.rotate(270).flop()
    case 8: return img.rotate(270)
    default: return img
  }
}

interface Opened {
  /** Pipeline producing correctly oriented pixels. */
  img: Sharp
  width: number
  height: number
  orientation?: number
  exif: ExifData | null
  format: string
  /** Raw TIFF EXIF block when the source is HEIF (sharp can't read it). */
  heifExif?: Buffer | null
  pages?: number
  bitDepth?: number
  hasAlpha?: boolean
  /** true when the pipeline can carry the source's own metadata through. */
  nativeMetadata: boolean
}

async function openImage(path: string, ext: string): Promise<Opened> {
  if (HEIF_IMAGE.has(ext)) {
    const buf = await readFile(path)
    const exif = await readHeifExif(buf)
    const d = await decodeHeic(buf)
    return {
      img: sharp(d.data, { raw: { width: d.width, height: d.height, channels: 4 } }),
      width: d.width,
      height: d.height,
      exif,
      format: 'HEIC',
      heifExif: heifExif(buf),
      nativeMetadata: false
    }
  }
  if (ext === 'bmp') {
    const buf = await readFile(path)
    const d = decodeBmp(buf)
    return {
      img: sharp(d.data, { raw: { width: d.width, height: d.height, channels: 4 } }),
      width: d.width,
      height: d.height,
      exif: null,
      format: 'BMP',
      nativeMetadata: false
    }
  }
  if (RAW_IMAGE.has(ext)) {
    const buf = await readFile(path)
    const exif = await readExif(buf)
    const jpeg = largestEmbeddedJpeg(buf)
    if (jpeg) {
      const meta = await sharp(jpeg).metadata()
      let img: Sharp
      let w = meta.width, h = meta.height
      if (meta.orientation && meta.orientation > 1) {
        img = sharp(jpeg, { autoOrient: true, failOn: 'none' })
        ;[w, h] = orientedDims(w, h, meta.orientation)
      } else {
        const o = exif?.Orientation ?? 1
        img = applyOrientation(sharp(jpeg, { failOn: 'none' }), o)
        ;[w, h] = orientedDims(w, h, o)
      }
      // Report sensor dimensions when EXIF has them; the preview may be smaller.
      let fw = w, fh = h
      if (exif?.ExifImageWidth && exif?.ExifImageHeight && exif.ExifImageWidth * exif.ExifImageHeight > w * h) {
        ;[fw, fh] = orientedDims(exif.ExifImageWidth, exif.ExifImageHeight, exif.Orientation)
        if ((fw > fh) !== (w > h)) [fw, fh] = [fh, fw]
      }
      return { img, width: fw, height: fh, exif, format: `${ext.toUpperCase()} (RAW)`, nativeMetadata: false }
    }
    // DNG and some TIFF-based RAWs without a JPEG preview: let libvips try.
    const meta = await sharp(buf, { failOn: 'none' }).metadata()
    const [w, h] = orientedDims(meta.width, meta.height, meta.orientation)
    return { img: sharp(buf, { autoOrient: true, failOn: 'none' }), width: w, height: h, exif, format: `${ext.toUpperCase()} (RAW)`, nativeMetadata: false }
  }
  if (SHARP_IMAGE.has(ext)) {
    const opts: SharpOptions = { failOn: 'none', limitInputPixels: 1_000_000_000, autoOrient: true }
    if (ext === 'svg') opts.density = 144
    const meta = await sharp(path, { failOn: 'none', limitInputPixels: 1_000_000_000 }).metadata()
    const exif = meta.exif ? await readExif(meta.exif) : null
    const [w, h] = orientedDims(meta.width, meta.height, meta.orientation)
    return {
      img: sharp(path, opts),
      width: w,
      height: h,
      orientation: meta.orientation,
      exif,
      format: meta.format.toUpperCase(),
      pages: meta.pages,
      bitDepth: meta.depth === 'ushort' ? 16 : meta.depth === 'float' ? 32 : 8,
      hasAlpha: meta.hasAlpha,
      nativeMetadata: true
    }
  }
  throw new Error('Unsupported image format')
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOENT/.test(msg)) return 'File not found'
  if (/EACCES|EPERM/.test(msg)) return 'Permission denied'
  if (/Old-style JPEG|compression method is not configured|TIFF directory is missing/i.test(msg)) return 'This RAW file has no preview that Loupe can display'
  if (/unsupported image format|Input file contains unsupported|not a HEIC|HEIF image not found|Unsupported image format/i.test(msg)) return 'Unsupported or unrecognised format'
  if (/premature end|truncated|corrupt|VipsJpeg|bad seek|Invalid|invalid|Malformed|moov atom not found/i.test(msg)) return 'The file appears to be damaged or incomplete'
  if (/No video stream|no video frame/i.test(msg)) return 'No playable video was found in this file'
  if (/ffmpeg unavailable/.test(msg)) return 'Video tools are unavailable'
  if (/pixel limit/i.test(msg)) return 'This image is too large to process'
  // libvips can repeat the same line many times; keep the first one.
  return (msg.split('\n').find((l) => l.trim()) ?? msg).trim().slice(0, 200)
}

// ─── tasks ──────────────────────────────────────────────────────────────────

interface ProbeFile {
  path: string
  size: number
  ext: string
  kind: MediaKind
}

interface ProbeOut {
  path: string
  quickHash?: string
  width?: number
  height?: number
  orientation?: number
  takenAt?: number
  duration?: number
  error?: string
}

const HEAD = 64 * 1024

async function quickHashOf(path: string, size: number): Promise<{ hash: string; head: Buffer }> {
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(size, HEAD))
    await fh.read(head, 0, head.length, 0)
    const h = createHash('sha1')
    h.update(String(size))
    h.update(head)
    if (size > HEAD * 2) {
      const tail = Buffer.alloc(HEAD)
      await fh.read(tail, 0, HEAD, size - HEAD)
      h.update(tail)
    } else if (size > HEAD) {
      const rest = Buffer.alloc(size - HEAD)
      await fh.read(rest, 0, rest.length, HEAD)
      h.update(rest)
    }
    return { hash: h.digest('hex'), head }
  } finally {
    await fh.close()
  }
}

async function probeOne(f: ProbeFile): Promise<ProbeOut> {
  const out: ProbeOut = { path: f.path }
  try {
    const { hash } = await quickHashOf(f.path, f.size)
    out.quickHash = hash
  } catch (err) {
    out.error = friendlyError(err)
    return out
  }
  try {
    if (f.kind === 'photo') {
      if (SHARP_IMAGE.has(f.ext) && f.ext !== 'svg') {
        const meta = await sharp(f.path, { failOn: 'none', limitInputPixels: 1_000_000_000 }).metadata()
        ;[out.width, out.height] = orientedDims(meta.width, meta.height, meta.orientation)
        out.orientation = meta.orientation
        if (meta.exif) out.takenAt = exifDate(await readExif(meta.exif))
      } else if (f.ext === 'svg') {
        const meta = await sharp(f.path).metadata()
        out.width = meta.width
        out.height = meta.height
      } else if (f.ext === 'bmp') {
        const fh = await open(f.path, 'r')
        try {
          const b = Buffer.alloc(26)
          await fh.read(b, 0, 26, 0)
          if (b.toString('latin1', 0, 2) === 'BM') {
            const hs = b.readUInt32LE(14)
            out.width = hs === 12 ? b.readUInt16LE(18) : Math.abs(b.readInt32LE(18))
            out.height = hs === 12 ? Math.abs(b.readInt16LE(20)) : Math.abs(b.readInt32LE(22))
          }
        } finally {
          await fh.close()
        }
      } else if (HEIF_IMAGE.has(f.ext)) {
        // Metadata lives in the 'meta' box near the start; read a head chunk first.
        const fh = await open(f.path, 'r')
        let head: Buffer
        try {
          head = Buffer.alloc(Math.min(f.size, 512 * 1024))
          await fh.read(head, 0, head.length, 0)
        } finally {
          await fh.close()
        }
        const size = heifSize(head)
        if (size) {
          out.width = size.width
          out.height = size.height
        }
        let tiff = heifExif(head)
        if (!tiff && f.size > head.length) tiff = heifExif(await readFile(f.path))
        if (tiff) out.takenAt = exifDate(await readExif(tiff))
      } else {
        // RAW: exifr reads just the chunks it needs.
        const e = await readExif(f.path)
        out.takenAt = exifDate(e)
        if (e?.ExifImageWidth && e?.ExifImageHeight) {
          ;[out.width, out.height] = orientedDims(e.ExifImageWidth, e.ExifImageHeight, e.Orientation)
        }
        out.orientation = e?.Orientation
      }
    } else if (['mp4', 'm4v', 'mov', 'qt', '3gp', '3g2'].includes(f.ext)) {
      const fh = await open(f.path, 'r')
      try {
        const info = await readMp4Info(fh, f.size)
        if (info) {
          out.width = info.width
          out.height = info.height
          out.duration = info.duration
          if (info.creationTime && info.creationTime > MIN_DATE && info.creationTime < Date.now() + 86_400_000) out.takenAt = info.creationTime
        }
      } finally {
        await fh.close()
      }
    }
  } catch {
    /* header parsing is best-effort; full processing will report real problems */
  }
  return out
}

async function probe(p: { files: ProbeFile[] }): Promise<ProbeOut[]> {
  const out: ProbeOut[] = []
  for (const f of p.files) out.push(await probeOne(f))
  return out
}

interface ProcessIn {
  path: string
  ext: string
  kind: MediaKind
  thumbPath: string
  thumbSize: number
  quality: number
}

interface ProcessOut {
  width?: number
  height?: number
  orientation?: number
  takenAt?: number
  duration?: number
  metadata: MediaMetadata
  camera?: string
  phash?: string
  size: number
  mtime: number
}

async function processItem(p: ProcessIn): Promise<ProcessOut> {
  const st = await stat(p.path)
  if (p.kind === 'video') return processVideo(p, st.size, st.mtimeMs)
  const o = await openImage(p.path, p.ext)
  const thumb = await o.img
    .clone()
    .resize(p.thumbSize, p.thumbSize, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: p.quality, effort: 2, smartSubsample: true })
    .toBuffer()
  await writeAtomic(p.thumbPath, thumb)
  const { metadata, camera } = metadataFromExif(o.exif, o.format)
  if (o.pages && o.pages > 1) metadata.pages = o.pages
  if (o.bitDepth && o.bitDepth !== 8) metadata.bitDepth = o.bitDepth
  if (o.hasAlpha) metadata.hasAlpha = true
  return {
    width: o.width,
    height: o.height,
    orientation: o.orientation ?? o.exif?.Orientation,
    takenAt: exifDate(o.exif),
    metadata,
    camera,
    phash: await dHash(thumb),
    size: st.size,
    mtime: st.mtimeMs
  }
}

async function processVideo(p: ProcessIn, size: number, mtime: number): Promise<ProcessOut> {
  if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg unavailable')
  const info = await ffprobe(ffprobePath, p.path)
  if (!info.width && !info.codec) throw new Error('No video stream found — the file may be damaged')
  const dur = info.duration ?? 0
  const at = dur > 2 ? Math.min(dur * 0.1, 30) : 0
  const frame = await extractFrame(ffmpegPath, p.path, at, p.thumbSize, info.hdr)
  const thumb = await sharp(frame).webp({ quality: p.quality, effort: 2 }).toBuffer()
  await writeAtomic(p.thumbPath, thumb)
  const model = info.model ? (info.make && !info.model.startsWith(info.make) ? `${info.make} ${info.model}` : info.model) : undefined
  return {
    width: info.width ?? undefined,
    height: info.height ?? undefined,
    duration: info.duration ?? undefined,
    takenAt: info.creationTime,
    metadata: {
      format: (info.container ?? '').split(',')[0].toUpperCase() || undefined,
      codec: info.codec,
      audioCodec: info.audioCodec,
      hasAudio: !!info.audioCodec,
      fps: info.fps,
      bitrate: info.bitrate,
      container: info.container,
      gps: info.gps,
      make: info.make,
      model
    },
    camera: model,
    phash: await dHash(thumb),
    size,
    mtime
  }
}

async function preview(p: { path: string; ext: string; outPath: string; maxSize: number }): Promise<{ width: number; height: number }> {
  const o = await openImage(p.path, p.ext)
  const { data, info } = await o.img
    .resize(p.maxSize, p.maxSize, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toBuffer({ resolveWithObject: true })
  await writeAtomic(p.outPath, data)
  return { width: info.width, height: info.height }
}

async function extThumb(p: { path: string; ext: string; kind: MediaKind; outPath: string; size: number }): Promise<{ width?: number; height?: number }> {
  if (p.kind === 'video') {
    if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg unavailable')
    const info = await ffprobe(ffprobePath, p.path)
    const dur = info.duration ?? 0
    const frame = await extractFrame(ffmpegPath, p.path, dur > 2 ? Math.min(dur * 0.1, 30) : 0, p.size, info.hdr)
    await writeAtomic(p.outPath, await sharp(frame).webp({ quality: 78 }).toBuffer())
    return { width: info.width ?? undefined, height: info.height ?? undefined }
  }
  const o = await openImage(p.path, p.ext)
  const buf = await o.img.resize(p.size, p.size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 2 }).toBuffer()
  await writeAtomic(p.outPath, buf)
  return { width: o.width, height: o.height }
}

async function fullHash(p: { path: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(p.path, { highWaterMark: 1024 * 1024 })
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

interface ConvertIn {
  input: string
  ext: string
  output: string
  format: ConvertFormat
  quality: number
  resize: 'original' | 'long' | 'width' | 'height' | 'percent'
  resizeValue: number
  keepMetadata: boolean
  stripLocation: boolean
  rotation: number
}

function exifStrings(e: ExifData | null): Exif {
  if (!e) return {}
  const ifd0: Record<string, string> = {}
  const ifd2: Record<string, string> = {}
  const fmt = (d: Date | string | undefined): string | undefined => {
    const t = validDate(d)
    if (!t) return undefined
    const x = new Date(t)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${x.getFullYear()}:${pad(x.getMonth() + 1)}:${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`
  }
  if (cleanStr(e.Make)) ifd0.Make = cleanStr(e.Make)!
  if (cleanStr(e.Model)) ifd0.Model = cleanStr(e.Model)!
  if (cleanStr(e.Software)) ifd0.Software = cleanStr(e.Software)!
  if (cleanStr(e.Artist)) ifd0.Artist = cleanStr(e.Artist)!
  if (cleanStr(e.Copyright)) ifd0.Copyright = cleanStr(e.Copyright)!
  const taken = fmt(e.DateTimeOriginal) ?? fmt(e.CreateDate)
  if (taken) {
    ifd0.DateTime = taken
    ifd2.DateTimeOriginal = taken
    ifd2.DateTimeDigitized = taken
  }
  if (cleanStr(e.LensModel)) ifd2.LensModel = cleanStr(e.LensModel)!
  return { IFD0: ifd0, IFD2: ifd2 }
}

async function convert(p: ConvertIn): Promise<{ bytes: number; width: number; height: number }> {
  const o = await openImage(p.input, p.ext)
  let img = o.img
  let w = o.width, h = o.height
  if (p.rotation % 360 !== 0) {
    // One rotation per sharp pipeline: materialise the oriented pixels first.
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).rotate(p.rotation)
    if (p.rotation % 180 !== 0) [w, h] = [h, w]
  }
  switch (p.resize) {
    case 'long': img = img.resize(p.resizeValue, p.resizeValue, { fit: 'inside', withoutEnlargement: true }); break
    case 'width': img = img.resize({ width: p.resizeValue, withoutEnlargement: true }); break
    case 'height': img = img.resize({ height: p.resizeValue, withoutEnlargement: true }); break
    case 'percent': {
      const f = Math.max(1, Math.min(400, p.resizeValue)) / 100
      img = img.resize(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f)), { fit: 'fill' })
      break
    }
  }
  // Metadata: carry everything through when the source format allows it;
  // HEIC → JPEG gets its original EXIF block spliced in; everything else (or
  // "remove location") gets the essential descriptive fields only.
  let injectHeifExif = false
  if (p.keepMetadata) {
    if (o.nativeMetadata && !p.stripLocation) img = img.keepMetadata()
    else if (o.heifExif && p.format === 'jpeg' && !p.stripLocation) injectHeifExif = true
    else img = img.withExif(exifStrings(o.exif))
  }
  if (o.nativeMetadata) img = img.keepIccProfile()

  const q = Math.max(1, Math.min(100, Math.round(p.quality)))
  switch (p.format) {
    case 'jpeg': img = img.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' }); break
    case 'png': img = img.png({ compressionLevel: 7, adaptiveFiltering: true }); break
    case 'webp': img = img.webp({ quality: q, effort: 4 }); break
    case 'avif': img = img.avif({ quality: q, effort: 2 }); break
    case 'tiff': img = img.tiff({ compression: 'lzw', predictor: 'horizontal' }); break
  }
  const encoded = await img.toBuffer({ resolveWithObject: true })
  const info = encoded.info
  let data: Buffer = encoded.data
  if (injectHeifExif && o.heifExif) data = insertJpegExif(data, resetOrientation(Buffer.from(o.heifExif)))
  await mkdir(dirname(p.output), { recursive: true })
  const tmp = `${p.output}.part`
  await writeFile(tmp, data)
  await rename(tmp, p.output).catch(async (err) => {
    await unlink(tmp).catch(() => undefined)
    throw err
  })
  return { bytes: data.length, width: info.width, height: info.height }
}

async function storyboard(p: { path: string; outPath: string; duration: number; aspect: number }): Promise<unknown> {
  if (!ffmpegPath) throw new Error('ffmpeg unavailable')
  await mkdir(dirname(p.outPath), { recursive: true })
  return makeStoryboard(ffmpegPath, p.path, p.duration, p.aspect, p.outPath)
}

// ─── dispatch ───────────────────────────────────────────────────────────────

const handlers: Record<string, (payload: never) => Promise<unknown>> = {
  probe: probe as (p: never) => Promise<unknown>,
  process: processItem as (p: never) => Promise<unknown>,
  preview: preview as (p: never) => Promise<unknown>,
  extThumb: extThumb as (p: never) => Promise<unknown>,
  hash: fullHash as (p: never) => Promise<unknown>,
  convert: convert as (p: never) => Promise<unknown>,
  storyboard: storyboard as (p: never) => Promise<unknown>
}

parentPort?.on('message', async (msg: { id: number; type: string; payload: unknown }) => {
  const fn = handlers[msg.type]
  try {
    if (!fn) throw new Error(`Unknown task ${msg.type}`)
    const result = await fn(msg.payload as never)
    parentPort!.postMessage({ id: msg.id, ok: true, result })
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).split('\n').filter((l, i, a) => l.trim() && a.indexOf(l) === i).slice(0, 4).join('\n')
    parentPort!.postMessage({ id: msg.id, ok: false, error: friendlyError(err), detail })
  }
})
