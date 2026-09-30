// loupe:// protocol — serves thumbnails, originals (with HTTP Range support so
// video seeking works), and lazily generated previews to the renderer without
// exposing arbitrary filesystem access.
//
//   loupe://thumb/<id>?v=<version>
//   loupe://media/<id>                 original file
//   loupe://preview/<id>               large JPEG for HEIC/RAW/TIFF (generated on demand)
//   loupe://storyboard/<id>            video scrub sprite
//   loupe://playable/<id>              H.264 copy of a video the browser can't decode
//   loupe://ext/file?p=<path>          a file opened from the OS (allow-listed)
//   loupe://ext/thumb?p=<path>         thumbnail for such a file
//   loupe://ext/preview?p=<path>       preview for such a file

import { protocol } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { stat, readFile, readdir, utimes } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { ctx } from './context'
import { LANE_INTERACTIVE } from './workers/pool'
import { extOf, kindOfExt, mimeOf, needsPreview } from '@shared/formats'
import { prefs } from './preferences'

export const SCHEME = 'loupe'

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    }
  ])
}

const BASE_HEADERS = { 'Access-Control-Allow-Origin': '*' }

function notFound(msg = 'Not found'): Response {
  return new Response(msg, { status: 404, headers: BASE_HEADERS })
}

async function fileResponse(path: string, req: Request, type: string, cache = 'no-cache'): Promise<Response> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return notFound()
  }
  const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache }
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : NaN
    let end = m && m[2] ? parseInt(m[2], 10) : NaN
    if (isNaN(start) && !isNaN(end)) {
      start = Math.max(0, size - end)
      end = size - 1
    } else {
      if (isNaN(start)) start = 0
      if (isNaN(end) || end >= size) end = size - 1
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    }
    const stream = createReadStream(path, { start, end, highWaterMark: 256 * 1024 })
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
    })
  }
  headers['Content-Length'] = String(size)
  if (size < 16 * 1024 * 1024) return new Response(await readFile(path), { status: 200, headers })
  return new Response(Readable.toWeb(createReadStream(path, { highWaterMark: 512 * 1024 })) as unknown as ReadableStream, { status: 200, headers })
}

// ─── allow-list for files opened from the OS ────────────────────────────────

const allowedFiles = new Set<string>()
const allowedDirs = new Set<string>()

export function allowExternal(paths: string[], includeSiblings = false): void {
  for (const p of paths) {
    allowedFiles.add(p)
    if (includeSiblings) allowedDirs.add(dirname(p))
  }
}

function isAllowed(p: string): boolean {
  return allowedFiles.has(p) || allowedDirs.has(dirname(p))
}

// ─── lazy generation with de-duplication ────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>()

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

let previewsSincePrune = 0

export async function ensurePreview(id: number): Promise<string | null> {
  const l = ctx.library
  if (!l || !ctx.pool) return null
  const out = l.previewPath(id)
  if (existsSync(out)) {
    void utimes(out, new Date(), new Date()).catch(() => undefined)
    return out
  }
  const row = l.db.get<{ path: string; in_library: number; ext: string }>('SELECT path, in_library, ext FROM media WHERE id = ?', id)
  if (!row) return null
  const pool = ctx.pool
  await once(`preview:${id}`, () =>
    pool.run('preview', { path: l.resolve(row.path, row.in_library), ext: row.ext, outPath: out, maxSize: 3072 }, LANE_INTERACTIVE)
  )
  if (++previewsSincePrune >= 25) {
    previewsSincePrune = 0
    void prunePreviews()
  }
  return out
}

/** Keep the preview cache under the configured size, evicting least-recently used. */
export async function prunePreviews(): Promise<number> {
  const l = ctx.library
  if (!l) return 0
  const limit = prefs.get().previewCacheMB * 1024 * 1024
  const files: { path: string; size: number; atime: number }[] = []
  const root = l.dir('previews')
  for (const shard of await readdir(root).catch(() => [] as string[])) {
    const dir = join(root, shard)
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      const p = join(dir, f)
      try {
        const st = await stat(p)
        files.push({ path: p, size: st.size, atime: Math.max(st.atimeMs, st.mtimeMs) })
      } catch {
        /* ignore */
      }
    }
  }
  let total = files.reduce((n, f) => n + f.size, 0)
  if (total <= limit) return 0
  files.sort((a, b) => a.atime - b.atime)
  let removed = 0
  const { rm } = await import('node:fs/promises')
  for (const f of files) {
    if (total <= limit * 0.85) break
    await rm(f.path, { force: true }).catch(() => undefined)
    total -= f.size
    removed++
  }
  return removed
}

function extCacheName(p: string, kind: string): string {
  return createHash('sha1').update(p).digest('hex') + (kind === 'thumb' ? '.webp' : '.jpg')
}

async function externalDerived(p: string, which: 'thumb' | 'preview'): Promise<string | null> {
  const l = ctx.library
  const pool = ctx.pool
  if (!pool) return null
  const { app } = await import('electron')
  const base = l ? l.cachePath('external') : join(app.getPath('temp'), 'loupe-external')
  const out = join(base, extCacheName(p, which))
  if (existsSync(out)) return out
  const ext = extOf(p)
  const kind = kindOfExt(ext)
  if (!kind) return null
  await once(`ext:${which}:${p}`, () =>
    which === 'thumb'
      ? pool.run('extThumb', { path: p, ext, kind, outPath: out, size: 400 }, LANE_INTERACTIVE)
      : pool.run('preview', { path: p, ext, outPath: out, maxSize: 3072 }, LANE_INTERACTIVE)
  )
  return out
}

// ─── handler ────────────────────────────────────────────────────────────────

export function handleProtocol(): void {
  protocol.handle(SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      const host = url.hostname
      const l = ctx.library
      if (host === 'ext') {
        const p = url.searchParams.get('p') ?? ''
        if (!p || !isAllowed(p)) return notFound()
        const which = url.pathname.replace(/^\//, '')
        if (which === 'file') return fileResponse(p, req, mimeOf(extOf(p)))
        if (which === 'thumb' || which === 'preview') {
          const out = await externalDerived(p, which)
          return out ? fileResponse(out, req, which === 'thumb' ? 'image/webp' : 'image/jpeg', 'max-age=3600') : notFound()
        }
        return notFound()
      }
      if (!l) return notFound('No library')
      const id = parseInt(url.pathname.replace(/^\//, ''), 10)
      if (!Number.isFinite(id)) return notFound()
      switch (host) {
        case 'thumb':
          return fileResponse(l.thumbPath(id), req, 'image/webp', 'max-age=31536000, immutable')
        case 'media': {
          const row = l.db.get<{ path: string; in_library: number; ext: string }>('SELECT path, in_library, ext FROM media WHERE id = ?', id)
          if (!row) return notFound()
          const abs = l.resolve(row.path, row.in_library)
          const res = await fileResponse(abs, req, mimeOf(row.ext))
          if (res.status === 404) l.db.run('UPDATE media SET missing = 1 WHERE id = ?', id)
          return res
        }
        case 'preview': {
          const row = l.db.get<{ ext: string; kind: number }>('SELECT ext, kind FROM media WHERE id = ?', id)
          if (!row) return notFound()
          if (row.kind === 1 && !needsPreview(row.ext)) {
            const r = l.db.get<{ path: string; in_library: number }>('SELECT path, in_library FROM media WHERE id = ?', id)!
            return fileResponse(l.resolve(r.path, r.in_library), req, mimeOf(row.ext))
          }
          try {
            const out = await ensurePreview(id)
            return out ? fileResponse(out, req, 'image/jpeg', 'max-age=3600') : notFound()
          } catch (err) {
            return new Response((err as Error).message, { status: 422, headers: BASE_HEADERS })
          }
        }
        case 'storyboard':
          return fileResponse(l.cachePath('storyboards', `${id}.jpg`), req, 'image/jpeg', 'max-age=3600')
        case 'playable':
          return fileResponse(l.cachePath('playable', `${id}.mp4`), req, 'video/mp4')
        default:
          return notFound()
      }
    } catch (err) {
      return new Response(String((err as Error).message), { status: 500, headers: BASE_HEADERS })
    }
  })
}
