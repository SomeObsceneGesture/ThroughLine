// ffmpeg / ffprobe helpers. Pure Node so they can run in worker threads too;
// binary paths are passed in by the caller.

import { execFile, spawn, type ChildProcess } from 'node:child_process'

export interface ProbeResult {
  duration: number | null
  width: number | null
  height: number | null
  codec?: string
  audioCodec?: string
  fps?: number
  bitrate?: number
  container?: string
  creationTime?: number
  rotation: number
  hdr: boolean
  gps?: { lat: number; lon: number; alt?: number }
  make?: string
  model?: string
}

interface FfStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  color_transfer?: string
  tags?: Record<string, string>
  side_data_list?: { rotation?: number; side_data_type?: string }[]
  disposition?: { attached_pic?: number }
}

function run(bin: string, args: string[], opts: { timeout?: number; maxBuffer?: number; encoding?: 'buffer' | 'utf8' } = {}): Promise<{ stdout: Buffer | string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: opts.timeout ?? 60_000, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, encoding: opts.encoding === 'buffer' ? 'buffer' : 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (typeof stderr === 'string' ? stderr : stderr?.toString()) || err.message
          reject(new Error(msg.trim().split('\n').slice(-3).join(' ')))
        } else resolve({ stdout, stderr: typeof stderr === 'string' ? stderr : stderr.toString() })
      }
    )
  })
}

function parseRate(r?: string): number | undefined {
  if (!r) return undefined
  const [a, b] = r.split('/').map(Number)
  if (!a || !b) return undefined
  const v = a / b
  return v > 0 && v < 1000 ? Math.round(v * 100) / 100 : undefined
}

function parseIso6709(s?: string): { lat: number; lon: number; alt?: number } | undefined {
  if (!s) return undefined
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(s)
  if (!m) return undefined
  const lat = parseFloat(m[1]), lon = parseFloat(m[2])
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return undefined
  return { lat, lon, alt: m[3] ? parseFloat(m[3]) : undefined }
}

export async function ffprobe(bin: string, file: string): Promise<ProbeResult> {
  const { stdout } = await run(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 })
  const json = JSON.parse(stdout as string) as { streams?: FfStream[]; format?: { duration?: string; bit_rate?: string; format_name?: string; tags?: Record<string, string> } }
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(json.format?.tags ?? {})) tags[k.toLowerCase()] = v
  let rotation = 0
  const sd = video?.side_data_list?.find((d) => typeof d.rotation === 'number')
  if (sd?.rotation) rotation = sd.rotation
  else if (video?.tags?.rotate) rotation = -parseInt(video.tags.rotate, 10)
  rotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360
  let width = video?.width ?? null
  let height = video?.height ?? null
  if (width && height && (rotation === 90 || rotation === 270)) [width, height] = [height, width]
  const created = tags['com.apple.quicktime.creationdate'] ?? tags['creation_time'] ?? video?.tags?.creation_time
  let creationTime: number | undefined
  if (created) {
    const t = Date.parse(created)
    // Many devices write 1970/1904 epochs when the clock was unset.
    if (isFinite(t) && t > Date.UTC(1980, 0, 1)) creationTime = t
  }
  const duration = parseFloat(json.format?.duration ?? '')
  return {
    duration: isFinite(duration) ? duration : null,
    width,
    height,
    codec: video?.codec_name,
    audioCodec: audio?.codec_name,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    bitrate: json.format?.bit_rate ? parseInt(json.format.bit_rate, 10) : undefined,
    container: json.format?.format_name,
    creationTime,
    rotation,
    hdr: video?.color_transfer === 'arib-std-b67' || video?.color_transfer === 'smpte2084',
    gps: parseIso6709(tags['com.apple.quicktime.location.iso6709'] ?? tags['location']),
    make: tags['com.apple.quicktime.make'] ?? tags['make'],
    model: tags['com.apple.quicktime.model'] ?? tags['model']
  }
}

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

/** Grab a single frame as PNG, scaled to fit within maxSize. */
export async function extractFrame(bin: string, file: string, at: number, maxSize: number, hdr = false): Promise<Buffer> {
  const scale = `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`
  const vf = hdr ? `${TONEMAP},${scale}` : scale
  const attempt = async (t: number, filter: string): Promise<Buffer> => {
    const { stdout } = await run(
      bin,
      ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-an', '-vf', filter, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
      { encoding: 'buffer', timeout: 60_000 }
    )
    return stdout as Buffer
  }
  let out: Buffer = Buffer.alloc(0)
  try {
    out = await attempt(at, vf)
  } catch (err) {
    if (!hdr) throw err
    out = await attempt(at, scale) // zscale can fail on unusual inputs
  }
  if (!out.length && at > 0) out = await attempt(0, vf)
  if (!out.length) throw new Error('No video frame could be decoded')
  return out
}

export interface StoryboardSpec {
  cols: number
  rows: number
  count: number
  interval: number
  tileWidth: number
  tileHeight: number
}

export async function makeStoryboard(bin: string, file: string, duration: number, aspect: number, outPath: string): Promise<StoryboardSpec> {
  const count = Math.max(8, Math.min(100, Math.ceil(duration / 2)))
  const interval = duration / count
  const cols = 10
  const rows = Math.ceil(count / cols)
  const tileWidth = 192
  const tileHeight = Math.max(2, Math.round(tileWidth / (aspect || 16 / 9) / 2) * 2)
  const args = ['-hide_banner', '-loglevel', 'error']
  if (duration > 90) args.push('-skip_frame', 'nokey')
  args.push('-i', file, '-an', '-vf', `fps=1/${interval.toFixed(4)},scale=${tileWidth}:${tileHeight},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', '-y', outPath)
  await run(bin, args, { timeout: 180_000 })
  return { cols, rows, count, interval, tileWidth, tileHeight }
}

export interface TranscodeHandle {
  promise: Promise<void>
  cancel(): void
}

/** Convert to H.264/AAC MP4 for playback, reporting progress 0..1. */
export function transcode(bin: string, input: string, output: string, duration: number, onProgress: (p: number) => void): TranscodeHandle {
  let child: ChildProcess | null = null
  let cancelled = false
  const promise = new Promise<void>((resolve, reject) => {
    child = spawn(
      bin,
      [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-vf', "scale='min(3840,iw)':-2",
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', output
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => {
      const m = /out_time_(?:us|ms)=(\d+)/.exec(d.toString())
      if (m && duration > 0) onProgress(Math.min(0.999, parseInt(m[1], 10) / 1e6 / duration))
    })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (cancelled) reject(new Error('cancelled'))
      else if (code === 0) resolve()
      else reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `ffmpeg exited with ${code}`))
    })
  })
  return {
    promise,
    cancel: () => {
      cancelled = true
      ;(child as ChildProcess | null)?.kill('SIGKILL')
    }
  }
}
