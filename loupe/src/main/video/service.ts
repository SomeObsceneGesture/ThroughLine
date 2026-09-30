// Video features that need ffmpeg: scrub-preview storyboards and on-demand
// H.264 copies for codecs Chromium can't decode (HEVC on some systems, AVI,
// WMV, MPEG-2...). Copies live in Library/Cache/playable and are pruned.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ctx, lib, pool } from '../context'
import { LANE_INTERACTIVE } from '../workers/pool'
import { emit } from '../events'
import { ffprobe, transcode, type StoryboardSpec, type TranscodeHandle } from './ffmpeg'
import type { PlayableInfo, Storyboard } from '@shared/types'

const storyboardJobs = new Map<number, Promise<Storyboard | null>>()

export function storyboardFor(id: number): Promise<Storyboard | null> {
  let job = storyboardJobs.get(id)
  if (!job) {
    job = buildStoryboard(id).finally(() => storyboardJobs.delete(id))
    storyboardJobs.set(id, job)
  }
  return job
}

async function buildStoryboard(id: number): Promise<Storyboard | null> {
  const l = lib()
  if (!ctx.ffmpegPath) return null
  const out = l.cachePath('storyboards', `${id}.jpg`)
  const specPath = `${out}.json`
  if (existsSync(out) && existsSync(specPath)) {
    try {
      const spec = JSON.parse(await readFile(specPath, 'utf8')) as StoryboardSpec
      return { url: `loupe://storyboard/${id}?v=${spec.count}`, ...spec }
    } catch {
      /* regenerate */
    }
  }
  const row = l.db.get<{ path: string; in_library: number; duration: number | null; width: number | null; height: number | null; kind: number }>(
    'SELECT path, in_library, duration, width, height, kind FROM media WHERE id = ?',
    id
  )
  if (!row || row.kind !== 2) return null
  const abs = l.resolve(row.path, row.in_library)
  let duration = row.duration
  let aspect = row.width && row.height ? row.width / row.height : 16 / 9
  if (!duration && ctx.ffprobePath) {
    const info = await ffprobe(ctx.ffprobePath, abs)
    duration = info.duration
    if (info.width && info.height) aspect = info.width / info.height
  }
  if (!duration || duration < 1) return null
  await mkdir(l.cachePath('storyboards'), { recursive: true })
  const spec = await pool().run<StoryboardSpec>('storyboard', { path: abs, outPath: out, duration, aspect }, LANE_INTERACTIVE)
  await writeFile(specPath, JSON.stringify(spec))
  return { url: `loupe://storyboard/${id}?v=${spec.count}`, ...spec }
}

const transcodes = new Map<number, TranscodeHandle>()

export async function playable(id: number, canPlayDirect: boolean): Promise<PlayableInfo> {
  const l = lib()
  if (canPlayDirect) return { status: 'direct', url: `loupe://media/${id}` }
  const out = l.cachePath('playable', `${id}.mp4`)
  if (existsSync(out)) return { status: 'ready', url: `loupe://playable/${id}` }
  if (!ctx.ffmpegPath) return { status: 'unavailable', reason: 'Video conversion tools are not available on this system.' }
  if (transcodes.has(id)) return { status: 'converting' }
  const row = l.db.get<{ path: string; in_library: number; duration: number | null }>('SELECT path, in_library, duration FROM media WHERE id = ?', id)
  if (!row) return { status: 'unavailable', reason: 'Item not found' }
  const abs = l.resolve(row.path, row.in_library)
  if (!existsSync(abs)) return { status: 'unavailable', reason: 'The original file is not available. It may be on a disconnected drive.' }
  await mkdir(l.cachePath('playable'), { recursive: true })
  let duration = row.duration ?? 0
  if (!duration && ctx.ffprobePath) duration = (await ffprobe(ctx.ffprobePath, abs).catch(() => null))?.duration ?? 0
  const part = `${out}.part.mp4`
  let last = 0
  const handle = transcode(ctx.ffmpegPath, abs, part, duration, (p) => {
    const now = Date.now()
    if (now - last > 250) {
      last = now
      emit('transcode:progress', { id, progress: p, done: false })
    }
  })
  transcodes.set(id, handle)
  handle.promise
    .then(async () => {
      await rename(part, out)
      emit('transcode:progress', { id, progress: 1, done: true, url: `loupe://playable/${id}` })
      void prunePlayable()
    })
    .catch(async (err: Error) => {
      await rm(part, { force: true }).catch(() => undefined)
      if (err.message !== 'cancelled') emit('transcode:progress', { id, progress: 0, done: true, error: err.message })
    })
    .finally(() => transcodes.delete(id))
  return { status: 'converting' }
}

export function cancelTranscode(id: number): void {
  transcodes.get(id)?.cancel()
}

export function cancelAllTranscodes(): void {
  for (const t of transcodes.values()) t.cancel()
}

/** Keep at most ~8 GB / 25 playable copies, evicting the oldest. */
async function prunePlayable(): Promise<void> {
  const dir = lib().cachePath('playable')
  const files = await Promise.all(
    (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.mp4') && !f.includes('.part'))
      .map(async (f) => {
        const st = await stat(join(dir, f))
        return { path: join(dir, f), size: st.size, t: st.mtimeMs }
      })
  )
  files.sort((a, b) => b.t - a.t)
  let total = 0
  for (let i = 0; i < files.length; i++) {
    total += files[i].size
    if (i >= 25 || total > 8 * 1024 ** 3) await rm(files[i].path, { force: true }).catch(() => undefined)
  }
}

export async function probeCodec(id: number): Promise<{ codec?: string; container?: string; audioCodec?: string } | null> {
  const l = lib()
  const row = l.db.get<{ path: string; in_library: number; metadata: string | null }>('SELECT path, in_library, metadata FROM media WHERE id = ?', id)
  if (!row) return null
  if (row.metadata) {
    try {
      const md = JSON.parse(row.metadata)
      if (md.codec) return { codec: md.codec, container: md.container, audioCodec: md.audioCodec }
    } catch {
      /* fall through */
    }
  }
  if (!ctx.ffprobePath) return null
  const info = await ffprobe(ctx.ffprobePath, l.resolve(row.path, row.in_library)).catch(() => null)
  return info ? { codec: info.codec, container: info.container, audioCodec: info.audioCodec } : null
}
