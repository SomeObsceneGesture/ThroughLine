// Background processing queue: generates thumbnails, reads full metadata and
// perceptual hashes for items that are already browsable. Items the user is
// looking at are prioritised; results are written in batched transactions.

import type { Library } from '../library/library'
import type { WorkerPool } from '../workers/pool'
import { LANE_BACKGROUND, TaskError } from '../workers/pool'
import { emit } from '../events'
import { ctx } from '../context'
import { prefs } from '../preferences'
import { kindName, updateSearchText } from '../library/media-repo'
import { ids as jsonIds } from '../library/db'
import type { MediaMetadata } from '@shared/types'

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

interface Result {
  id: number
  out?: ProcessOut
  error?: string
  missing?: boolean
}

export function thumbSpec(): { size: number; quality: number } {
  return prefs.get().thumbnailQuality === 'high' ? { size: 800, quality: 80 } : { size: 512, quality: 76 }
}

export function dateParts(t: number): { year: number; month: number } {
  const d = new Date(t)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export class Indexer {
  private queue: number[] = []
  private head = 0
  private priority: number[] = []
  private queued = new Set<number>()
  private inFlight = new Set<number>()
  private results: Result[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private paused = false
  private stopped = false
  done = 0
  total = 0
  failed = 0

  constructor(private lib: Library, private pool: WorkerPool) {}

  loadPending(): void {
    const rows = this.lib.db.all<{ id: number }>(
      'SELECT id FROM media WHERE thumb_state = 0 AND deleted_at IS NULL ORDER BY sort_date DESC, id DESC'
    )
    this.enqueue(rows.map((r) => r.id))
  }

  enqueue(ids: number[]): void {
    let added = 0
    for (const id of ids) {
      if (this.queued.has(id) || this.inFlight.has(id)) continue
      this.queued.add(id)
      this.queue.push(id)
      added++
    }
    this.total += added
    this.pump()
    this.scheduleStatus()
  }

  /** Move ids the user is currently looking at to the front of the queue. */
  prioritize(ids: number[]): void {
    const fresh: number[] = []
    for (const id of ids) if (this.queued.has(id)) fresh.push(id)
    if (!fresh.length) return
    this.priority = [...fresh, ...this.priority.filter((x) => !fresh.includes(x))].slice(0, 2000)
    this.pump()
  }

  setPaused(p: boolean): void {
    this.paused = p
    if (!p) this.pump()
    this.scheduleStatus()
  }

  isPaused(): boolean {
    return this.paused
  }

  status(): { done: number; total: number; paused: boolean; failed: number } {
    return { done: this.done, total: this.total, paused: this.paused, failed: this.failed }
  }

  private next(): number | undefined {
    while (this.priority.length) {
      const id = this.priority.shift()!
      if (this.queued.has(id)) return id
    }
    while (this.head < this.queue.length) {
      const id = this.queue[this.head++]
      if (this.queued.has(id)) return id
    }
    if (this.head > 0) {
      this.queue = []
      this.head = 0
    }
    return undefined
  }

  private pump(): void {
    if (this.paused || this.stopped) return
    const limit = this.pool.capacity() + 2
    while (this.inFlight.size < limit) {
      const id = this.next()
      if (id === undefined) break
      this.queued.delete(id)
      this.dispatch(id)
    }
  }

  private dispatch(id: number): void {
    const row = this.lib.db.get<{ path: string; in_library: number; ext: string; kind: number; deleted_at: number | null; thumb_state: number }>(
      'SELECT path, in_library, ext, kind, deleted_at, thumb_state FROM media WHERE id = ?',
      id
    )
    if (!row || row.deleted_at) {
      this.done++
      return
    }
    const spec = thumbSpec()
    this.inFlight.add(id)
    this.pool
      .run<ProcessOut>(
        'process',
        {
          path: this.lib.resolve(row.path, row.in_library),
          ext: row.ext,
          kind: kindName(row.kind),
          thumbPath: this.lib.thumbPath(id),
          thumbSize: spec.size,
          quality: spec.quality
        },
        LANE_BACKGROUND
      )
      .then((out) => this.results.push({ id, out }))
      .catch((err: Error) => {
        const detail = err instanceof TaskError ? err.detail : err.message
        this.results.push({ id, error: err.message, missing: /ENOENT/.test(detail ?? '') || err.message === 'File not found' })
      })
      .finally(() => {
        this.inFlight.delete(id)
        this.done++
        this.scheduleFlush()
        this.pump()
      })
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    this.flushTimer = null
    if (!this.results.length || this.stopped) return
    const batch = this.results
    this.results = []
    const preferExif = prefs.get().metadata.preferExifDate
    const changedIds: number[] = []
    const orderChanged: number[] = []
    const searchChanged: number[] = []
    this.lib.db.tx(() => {
      for (const r of batch) {
        const cur = this.lib.db.get<{ sort_date: number; mtime: number; taken_at: number | null; camera: string | null }>(
          'SELECT sort_date, mtime, taken_at, camera FROM media WHERE id = ?',
          r.id
        )
        if (!cur) continue
        changedIds.push(r.id)
        if (!r.out) {
          this.failed++
          this.lib.db.run(
            'UPDATE media SET thumb_state = 2, error = ?, missing = ? WHERE id = ?',
            r.error ?? 'Could not be processed',
            r.missing ? 1 : 0,
            r.id
          )
          continue
        }
        const o = r.out
        const takenAt = o.takenAt ?? cur.taken_at ?? null
        const sortDate = preferExif && takenAt ? takenAt : cur.mtime
        const { year, month } = dateParts(sortDate)
        if (sortDate !== cur.sort_date) orderChanged.push(r.id)
        if (sortDate !== cur.sort_date || (o.camera ?? null) !== cur.camera || o.metadata.lens) searchChanged.push(r.id)
        this.lib.db.run(
          `UPDATE media SET width = COALESCE(?, width), height = COALESCE(?, height), orientation = COALESCE(?, orientation),
             duration = COALESCE(?, duration), taken_at = ?, sort_date = ?, year = ?, month = ?, metadata = ?, camera = ?,
             phash = ?, thumb_state = 1, thumb_version = thumb_version + 1, error = NULL, missing = 0
           WHERE id = ?`,
          o.width ?? null,
          o.height ?? null,
          o.orientation ?? null,
          o.duration ?? null,
          takenAt,
          sortDate,
          year,
          month,
          JSON.stringify(o.metadata),
          o.camera ?? null,
          o.phash ?? null,
          r.id
        )
      }
    })
    if (searchChanged.length) updateSearchText(this.lib, searchChanged)
    if (changedIds.length) emit('media:updated', { ids: changedIds })
    if (orderChanged.length) ctx.changes.items(orderChanged)
    this.scheduleStatus()
  }

  /** Regenerate thumbnails for specific items (e.g. after a quality change). */
  regenerate(ids: number[]): void {
    this.lib.db.run('UPDATE media SET thumb_state = 0 WHERE id IN (SELECT value FROM json_each(?))', jsonIds(ids))
    this.enqueue(ids)
    this.prioritize(ids)
  }

  private scheduleStatus(): void {
    if (this.statusTimer) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      if (this.inFlight.size === 0 && this.queued.size === 0 && !this.results.length && this.done >= this.total && this.total > 0) {
        // Everything processed: reset counters so the next batch starts at 0.
        this.done = 0
        this.total = 0
        this.failed = 0
      }
      broadcastActivity()
    }, 200)
  }

  stop(): void {
    this.stopped = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.queue = []
    this.priority = []
    this.queued.clear()
  }
}

let activityTask: { label: string; done: number; total: number } | null = null

export function setActivityTask(t: { label: string; done: number; total: number } | null): void {
  activityTask = t
  broadcastActivity()
}

export function activityStatus(): import('@shared/types').ActivityStatus {
  return {
    import: ctx.importer?.status() ?? null,
    processing: ctx.indexer?.status() ?? { done: 0, total: 0, paused: false, failed: 0 },
    task: activityTask
  }
}

export function broadcastActivity(): void {
  emit('activity', activityStatus())
}
