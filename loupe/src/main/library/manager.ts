// Opening, creating and closing libraries, and starting their background services.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ctx } from '../context'
import { Library } from './library'
import { WorkerPool } from '../workers/pool'
import { Indexer, broadcastActivity } from '../import/indexer'
import { Importer } from '../import/importer'
import { prefs } from '../preferences'
import { history } from './history'
import { emit } from '../events'
import { counts } from './media-repo'
import { prunePreviews } from '../protocol'
import { cancelAllTranscodes } from '../video/service'
import type { LibraryInfo, LibraryOpenResult, LibraryStats } from '@shared/types'

export function ensurePool(): WorkerPool {
  if (!ctx.pool) {
    const n = prefs.get().workerThreads || WorkerPool.defaultSize()
    ctx.pool = new WorkerPool(ctx.workerScript, { ffmpegPath: ctx.ffmpegPath, ffprobePath: ctx.ffprobePath }, n)
  }
  return ctx.pool
}

export function libraryInfo(): LibraryInfo | null {
  const l = ctx.library
  if (!l) return null
  return { path: l.root, name: l.name, id: l.manifest.id, createdAt: l.manifest.createdAt, counts: counts(l) }
}

function rememberRecent(path: string): void {
  const recent = [path, ...prefs.get().recentLibraries.filter((p) => p !== path)].slice(0, 8)
  prefs.set({ lastLibrary: path, recentLibraries: recent })
}

export async function closeLibrary(): Promise<void> {
  if (!ctx.library) return
  ctx.importer?.cancel()
  ctx.indexer?.flush()
  ctx.indexer?.stop()
  cancelAllTranscodes()
  ctx.changes.flush()
  ctx.library.close()
  ctx.library = null
  ctx.indexer = null
  ctx.importer = null
  history.clear()
}

export async function openLibrary(path: string): Promise<LibraryOpenResult> {
  try {
    await closeLibrary()
    const l = Library.open(path)
    start(l)
    return { ok: true, info: libraryInfo()! }
  } catch (err) {
    const msg = (err as Error).message
    if (msg === 'LIBRARY_MISSING') return { ok: false, missing: true, error: 'The library folder could not be found. If it is on an external drive, connect the drive and try again.' }
    return { ok: false, error: msg }
  }
}

export async function createLibrary(parentDir: string, name: string): Promise<LibraryOpenResult> {
  try {
    await closeLibrary()
    const l = Library.create(parentDir, name.trim() || 'Loupe Library')
    start(l)
    return { ok: true, info: libraryInfo()! }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function start(l: Library): void {
  ctx.library = l
  const pool = ensurePool()
  ctx.indexer = new Indexer(l, pool)
  ctx.importer = new Importer(l, pool, ctx.indexer)
  ctx.indexer.loadPending()
  rememberRecent(l.root)
  emit('library:opened', libraryInfo())
  broadcastActivity()
  // Housekeeping once the UI has settled.
  setTimeout(() => {
    if (ctx.library !== l) return
    void prunePreviews()
    void sweepOrphans(l)
    if (prefs.get().rescanOnLaunch) void rescanReferencedRoots(l)
  }, 15_000)
}

/** Remove generated thumbnails/previews whose media rows no longer exist. */
async function sweepOrphans(l: Library): Promise<void> {
  const live = new Set(l.db.all<{ id: number }>('SELECT id FROM media').map((r) => r.id))
  for (const dirName of ['thumbnails', 'previews'] as const) {
    const root = l.dir(dirName)
    for (const shard of await readdir(root).catch(() => [] as string[])) {
      for (const f of await readdir(join(root, shard)).catch(() => [] as string[])) {
        const id = parseInt(f, 10)
        if (Number.isFinite(id) && !live.has(id)) await rm(join(root, shard, f), { force: true }).catch(() => undefined)
        else if (f.endsWith('.tmp')) await rm(join(root, shard, f), { force: true }).catch(() => undefined)
      }
      if (ctx.library !== l) return
    }
  }
}

async function rescanReferencedRoots(l: Library): Promise<void> {
  const roots = l.db.all<{ path: string }>('SELECT path FROM folders WHERE is_root = 1 AND in_library = 0')
  const present = roots.map((r) => r.path).filter((p) => existsSync(p))
  if (present.length && ctx.importer && ctx.library === l) ctx.importer.start({ paths: present, mode: 'reference' })
}

async function dirSize(dir: string, depth = 3): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth > 0) total += await dirSize(p, depth - 1)
    else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size
  }
  return total
}

export async function libraryStats(): Promise<LibraryStats> {
  const l = ctx.library
  if (!l) throw new Error('No library is open')
  const r = l.db.get<Record<string, number>>(`
    SELECT
      count(*) FILTER (WHERE kind = 1 AND deleted_at IS NULL) AS photos,
      count(*) FILTER (WHERE kind = 2 AND deleted_at IS NULL) AS videos,
      COALESCE(SUM(size) FILTER (WHERE in_library = 1), 0) AS copied_bytes,
      COALESCE(SUM(size) FILTER (WHERE in_library = 0), 0) AS ref_bytes,
      count(*) FILTER (WHERE in_library = 1) AS copied,
      count(*) FILTER (WHERE in_library = 0) AS referenced
    FROM media`)!
  const [thumbs, previews, cache] = await Promise.all([dirSize(l.dir('thumbnails')), dirSize(l.dir('previews')), dirSize(l.dir('cache'))])
  const dbFile = join(l.dir('database'), 'library.db')
  const dbBytes = (await stat(dbFile).catch(() => ({ size: 0 }))).size + (await stat(`${dbFile}-wal`).catch(() => ({ size: 0 }))).size
  return {
    photos: r.photos,
    videos: r.videos,
    originalsBytes: r.copied_bytes,
    referencedBytes: r.ref_bytes,
    copiedCount: r.copied,
    referencedCount: r.referenced,
    thumbnailsBytes: thumbs,
    previewsBytes: previews,
    cacheBytes: cache,
    databaseBytes: dbBytes,
    lastImport: l.db.value<number>('SELECT MAX(finished_at) FROM imports') ?? null
  }
}

export function defaultLibraryLocation(): string {
  try {
    return app.getPath('pictures')
  } catch {
    return app.getPath('home')
  }
}
