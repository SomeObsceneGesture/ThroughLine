// Import jobs: scan dropped paths, detect duplicates, copy (or reference)
// files, and insert rows in streaming batches so media appears in the gallery
// almost immediately. Thumbnails are generated afterwards by the Indexer.

import { copyFile, mkdir, utimes, constants as fsConst } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, dirname, relative, extname, sep } from 'node:path'
import type { Library } from '../library/library'
import type { WorkerPool } from '../workers/pool'
import { LANE_IMPORT } from '../workers/pool'
import type { Indexer } from './indexer'
import { broadcastActivity, dateParts } from './indexer'
import { scan, type ScannedFile } from './scanner'
import { FolderIndex } from '../library/folders'
import { updateSearchText, kindCode } from '../library/media-repo'
import { emit } from '../events'
import { ctx } from '../context'
import { prefs } from '../preferences'
import { DIRS } from '../library/library'
import type { ActivityStatus, ImportIssue, ImportRequest, ImportSummary, ScanPreview } from '@shared/types'
import { history } from '../library/history'

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

interface QueuedJob {
  id: number
  req: ImportRequest
  forced: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')

function dateStamp(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dateName(t: number, ext: string): string {
  const d = new Date(t)
  return `${dateStamp(t)} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.${ext}`
}

/** Pick a non-existing path by appending " (1)", " (2)"... */
export function uniquePath(p: string, taken?: Set<string>): string {
  if (!existsSync(p) && !taken?.has(p)) return p
  const ext = extname(p)
  const base = p.slice(0, p.length - ext.length)
  for (let i = 1; i < 100000; i++) {
    const c = `${base} (${i})${ext}`
    if (!existsSync(c) && !taken?.has(c)) return c
  }
  throw new Error('Could not find a free file name')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export class Importer {
  private queue: QueuedJob[] = []
  private current: ImportJob | null = null
  private nextId = 1

  constructor(private lib: Library, private pool: WorkerPool, private indexer: Indexer) {}

  start(req: ImportRequest, forced = false): number {
    const id = this.nextId++
    this.queue.push({ id, req, forced })
    if (!this.current) void this.runNext()
    else broadcastActivity()
    return id
  }

  cancel(): void {
    this.current?.cancel()
    this.queue = []
  }

  status(): ActivityStatus['import'] {
    if (!this.current) return null
    return { ...this.current.status(), queued: this.queue.length }
  }

  private async runNext(): Promise<void> {
    const next = this.queue.shift()
    if (!next) {
      this.current = null
      broadcastActivity()
      return
    }
    this.current = new ImportJob(this.lib, this.pool, this.indexer, next.req, next.forced)
    try {
      const summary = await this.current.run()
      emit('import:finished', summary)
    } catch (err) {
      console.error('Import failed', err)
      emit('toast', { kind: 'error', message: 'The import stopped unexpectedly.', detail: err instanceof Error ? err.message : String(err) })
    }
    this.current = null
    void this.runNext()
  }
}

class ImportJob {
  private signal = { cancelled: false }
  private phase: 'scanning' | 'importing' = 'scanning'
  private found = 0
  private processed = 0
  private added = 0
  private alreadyInLibrary = 0
  private duplicates: ImportIssue[] = []
  private failed: ImportIssue[] = []
  private currentPath?: string
  private importId = 0
  private folders: FolderIndex
  private seen = new Map<string, string>()
  private reservedDest = new Set<string>()
  private lastEmit = 0
  private importDay = dateStamp(Date.now())
  private addedIds: number[] = []

  constructor(
    private lib: Library,
    private pool: WorkerPool,
    private indexer: Indexer,
    private req: ImportRequest,
    private forced: boolean
  ) {
    this.folders = new FolderIndex(lib)
  }

  cancel(): void {
    this.signal.cancelled = true
  }

  status(): Omit<NonNullable<ActivityStatus['import']>, 'queued'> {
    return {
      jobId: this.importId,
      phase: this.phase,
      found: this.found,
      processed: this.processed,
      added: this.added,
      skipped: this.alreadyInLibrary + this.duplicates.length,
      failed: this.failed.length,
      currentPath: this.currentPath
    }
  }

  private tick(force = false): void {
    const now = Date.now()
    if (force || now - this.lastEmit > 150) {
      this.lastEmit = now
      broadcastActivity()
    }
  }

  async run(): Promise<ImportSummary> {
    const started = Date.now()
    this.importId = this.lib.db.run(
      'INSERT INTO imports(started_at, mode, sources) VALUES (?, ?, ?)',
      started,
      this.req.mode,
      JSON.stringify(this.req.paths)
    ).lastInsertRowid
    this.tick(true)

    const exclude = [DIRS.thumbnails, DIRS.previews, DIRS.database, DIRS.cache].map((d) => join(this.lib.root, d))
    const pending: ScannedFile[] = []
    const CHUNK = 128
    for await (const batch of scan(this.req.paths, { exclude, signal: this.signal })) {
      this.found += batch.length
      pending.push(...batch)
      this.phase = 'importing'
      while (pending.length >= CHUNK && !this.signal.cancelled) {
        await this.processChunk(pending.splice(0, CHUNK))
      }
      this.tick()
      if (this.signal.cancelled) break
    }
    while (pending.length && !this.signal.cancelled) await this.processChunk(pending.splice(0, CHUNK))

    this.lib.db.run(
      'UPDATE imports SET finished_at = ?, added = ?, duplicates = ?, failed = ?, cancelled = ? WHERE id = ?',
      Date.now(),
      this.added,
      this.duplicates.length,
      this.failed.length,
      this.signal.cancelled ? 1 : 0,
      this.importId
    )
    if (this.added === 0) this.lib.db.run('DELETE FROM imports WHERE id = ? AND added = 0', this.importId)
    ctx.changes.structure()
    ctx.changes.flush()

    if (this.addedIds.length) {
      const ids = [...this.addedIds]
      const lib = this.lib
      history.push({
        label: `Import ${ids.length.toLocaleString()} item${ids.length === 1 ? '' : 's'}`,
        undo: () => {
          lib.db.run('UPDATE media SET deleted_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL', Date.now(), JSON.stringify(ids))
          ctx.changes.structure()
        },
        redo: () => {
          lib.db.run('UPDATE media SET deleted_at = NULL WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids))
          ctx.changes.structure()
        }
      })
    }

    return {
      jobId: this.importId,
      added: this.added,
      alreadyInLibrary: this.alreadyInLibrary,
      duplicates: this.duplicates,
      failed: this.failed,
      cancelled: this.signal.cancelled,
      mode: this.req.mode,
      durationMs: Date.now() - started,
      albumId: this.req.albumId
    }
  }

  private destinationFor(f: ScannedFile, takenAt: number): { dir: string; root: string; name: string } {
    const originals = this.lib.dir('originals')
    const p = prefs.get()
    const name = p.metadata.copyNaming === 'date' ? dateName(takenAt, f.ext) : basename(f.path)
    if (p.copyOrganization === 'date') {
      const d = new Date(takenAt)
      const yearDir = join(originals, String(d.getFullYear()))
      return { dir: join(yearDir, dateStamp(takenAt)), root: yearDir, name }
    }
    if (f.fromFolder) {
      const rootName = basename(f.root) || 'Imported'
      const rootDir = join(originals, rootName)
      const rel = relative(f.root, dirname(f.path))
      return { dir: rel ? join(rootDir, rel) : rootDir, root: rootDir, name }
    }
    const rootDir = join(originals, `Imported ${this.importDay}`)
    return { dir: rootDir, root: rootDir, name }
  }

  private async processChunk(files: ScannedFile[]): Promise<void> {
    this.currentPath = files[0]?.path
    // Probe in parallel across the worker pool, keeping file order.
    const parts = Math.max(1, Math.min(this.pool.size, Math.ceil(files.length / 8)))
    const per = Math.ceil(files.length / parts)
    const groups = Array.from({ length: parts }, (_, i) => files.slice(i * per, (i + 1) * per)).filter((g) => g.length)
    const probed = await Promise.all(
      groups.map((g) =>
        this.pool
          .run<ProbeOut[]>('probe', { files: g.map((f) => ({ path: f.path, size: f.size, ext: f.ext, kind: f.kind })) }, LANE_IMPORT)
          .catch((err: Error) => g.map((f) => ({ path: f.path, error: err.message })))
      )
    )
    const probes: ProbeOut[] = probed.flat()

    const dupPolicy = this.forced ? 'import' : prefs.get().duplicateHandling
    const preferExif = prefs.get().metadata.preferExifDate
    const rows: {
      f: ScannedFile
      pr: ProbeOut
      stored: { path: string; inLibrary: number }
      abs: string
      folderAbs: string
      rootAbs: string
    }[] = []
    const toCopy: { from: string; to: string; mtime: number; idx: number }[] = []

    for (let i = 0; i < files.length; i++) {
      if (this.signal.cancelled) break
      const f = files[i]
      const pr = probes[i] ?? { path: f.path }
      this.processed++
      if (pr.error || !pr.quickHash) {
        this.failed.push({ path: f.path, reason: pr.error ?? "Couldn't be read" })
        continue
      }
      const insideLibrary = this.lib.contains(f.path)
      const storedSrc = this.lib.toStored(f.path)
      // Already in the library at this exact path?
      const existing = this.lib.db.get<{ id: number; deleted_at: number | null }>(
        'SELECT id, deleted_at FROM media WHERE in_library = ? AND path = ?',
        storedSrc.inLibrary,
        storedSrc.path
      )
      if (existing && (this.req.mode === 'reference' || insideLibrary)) {
        if (existing.deleted_at) {
          this.lib.db.run('UPDATE media SET deleted_at = NULL WHERE id = ?', existing.id)
          this.added++
        } else this.alreadyInLibrary++
        continue
      }
      // Content duplicates (same bytes elsewhere in the library or this import).
      const key = `${f.size}:${pr.quickHash}`
      if (dupPolicy === 'skip') {
        const dup = this.lib.db.get<{ id: number; path: string; in_library: number }>(
          'SELECT id, path, in_library FROM media WHERE size = ? AND quick_hash = ? AND deleted_at IS NULL LIMIT 1',
          f.size,
          pr.quickHash
        )
        if (dup) {
          this.duplicates.push({ path: f.path, reason: `Already in your library as ${basename(dup.path)}`, existingId: dup.id })
          continue
        }
        const earlier = this.seen.get(key)
        if (earlier) {
          this.duplicates.push({ path: f.path, reason: `Same file as ${basename(earlier)} in this import` })
          continue
        }
      }
      this.seen.set(key, f.path)

      const takenAt = pr.takenAt && preferExif ? pr.takenAt : f.mtime
      if (this.req.mode === 'copy' && !insideLibrary) {
        const dest = this.destinationFor(f, takenAt)
        const target = uniquePath(join(dest.dir, dest.name), this.reservedDest)
        this.reservedDest.add(target)
        toCopy.push({ from: f.path, to: target, mtime: f.mtime, idx: rows.length })
        rows.push({ f, pr, stored: this.lib.toStored(target), abs: target, folderAbs: dirname(target), rootAbs: dest.root })
      } else {
        let rootAbs = f.root
        if (insideLibrary) {
          const rel = relative(this.lib.dir('originals'), f.path)
          const first = rel.split(sep)[0]
          rootAbs = rel.startsWith('..') ? dirname(f.path) : join(this.lib.dir('originals'), first)
          if (rootAbs === f.path) rootAbs = dirname(f.path)
        }
        rows.push({ f, pr, stored: storedSrc, abs: f.path, folderAbs: dirname(f.path), rootAbs })
      }
    }

    // Copy files (bounded parallelism, never overwriting).
    const copyFailed = new Set<number>()
    await mapLimit(toCopy, 4, async (c) => {
      if (this.signal.cancelled) {
        copyFailed.add(c.idx)
        return
      }
      try {
        await mkdir(dirname(c.to), { recursive: true })
        await copyFile(c.from, c.to, fsConst.COPYFILE_EXCL)
        const t = new Date(c.mtime)
        await utimes(c.to, t, t).catch(() => undefined)
      } catch (err) {
        copyFailed.add(c.idx)
        const code = (err as NodeJS.ErrnoException).code
        this.failed.push({
          path: c.from,
          reason: code === 'ENOSPC' ? 'Not enough space on the library drive' : code === 'EACCES' || code === 'EPERM' ? "Permission denied — couldn't copy" : `Couldn't copy: ${(err as Error).message}`
        })
      }
    })

    const now = Date.now()
    const newIds: number[] = []
    this.lib.db.tx(() => {
      for (let i = 0; i < rows.length; i++) {
        if (copyFailed.has(i)) continue
        const { f, pr, stored, folderAbs, rootAbs } = rows[i]
        const folderId = this.folders.ensure(folderAbs, rootAbs)
        const sortDate = pr.takenAt && preferExif ? pr.takenAt : f.mtime
        const { year, month } = dateParts(sortDate)
        const r = this.lib.db.run(
          `INSERT INTO media (kind, path, in_library, folder_id, filename, ext, size, mtime, taken_at, sort_date, year, month,
             added_at, import_id, width, height, duration, orientation, quick_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(in_library, path) DO NOTHING`,
          kindCode(f.kind),
          stored.path,
          stored.inLibrary,
          folderId,
          basename(stored.path),
          f.ext,
          f.size,
          Math.round(f.mtime),
          pr.takenAt ?? null,
          Math.round(sortDate),
          year,
          month,
          now,
          this.importId,
          pr.width ?? null,
          pr.height ?? null,
          pr.duration ?? null,
          pr.orientation ?? null,
          pr.quickHash ?? null
        )
        if (r.changes) newIds.push(r.lastInsertRowid)
        else this.alreadyInLibrary++
      }
      if (this.req.albumId && newIds.length) {
        const base = this.lib.db.value<number>('SELECT COALESCE(MAX(position), 0) FROM album_items WHERE album_id = ?', this.req.albumId) ?? 0
        newIds.forEach((id, i) =>
          this.lib.db.run(
            'INSERT OR IGNORE INTO album_items(album_id, media_id, position, added_at) VALUES (?, ?, ?, ?)',
            this.req.albumId!,
            id,
            base + i + 1,
            now
          )
        )
        this.lib.db.run('UPDATE albums SET updated_at = ? WHERE id = ?', now, this.req.albumId)
      }
    })
    if (newIds.length) {
      updateSearchText(this.lib, newIds)
      this.added += newIds.length
      this.addedIds.push(...newIds)
      this.indexer.enqueue(newIds)
      ctx.changes.structure()
    }
    this.tick()
  }
}

/** Quick pre-flight count shown in the import dialog. Capped for huge trees. */
export async function previewImport(lib: Library, paths: string[]): Promise<ScanPreview> {
  const out: ScanPreview = { files: 0, photos: 0, videos: 0, folders: 0, bytes: 0, unsupported: 0, truncated: false, inLibrary: false }
  const exclude = [DIRS.thumbnails, DIRS.previews, DIRS.database, DIRS.cache].map((d) => join(lib.root, d))
  const signal = { cancelled: false }
  const started = Date.now()
  out.inLibrary = paths.every((p) => lib.contains(p))
  for await (const batch of scan(paths, { exclude, signal, onUnsupported: () => out.unsupported++, onDir: () => out.folders++ }, 512)) {
    for (const f of batch) {
      out.files++
      out.bytes += f.size
      if (f.kind === 'video') out.videos++
      else out.photos++
    }
    if (Date.now() - started > 1500) {
      out.truncated = true
      signal.cancelled = true
      break
    }
  }
  return out
}
