// Batch image conversion. Originals are never modified or overwritten:
// outputs always get a fresh file name.

import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { ctx, lib, pool } from '../context'
import { LANE_IMPORT } from '../workers/pool'
import { emit } from '../events'
import { scan } from '../import/scanner'
import { uniquePath } from '../import/importer'
import { ids as jsonIds } from '../library/db'
import { DIRS } from '../library/library'
import type { ConvertJobItem, ConvertOptions, ConvertProgress } from '@shared/types'
import { extOf } from '@shared/formats'

const jobs = new Map<number, { cancelled: boolean }>()
let nextJob = 1

export async function expandPaths(paths: string[]): Promise<ConvertJobItem[]> {
  const out: ConvertJobItem[] = []
  const exclude = ctx.library ? [DIRS.thumbnails, DIRS.previews, DIRS.cache, DIRS.database].map((d) => join(ctx.library!.root, d)) : []
  for await (const batch of scan(paths, { exclude })) {
    for (const f of batch) if (f.kind === 'photo') out.push({ path: f.path, mediaId: findMediaId(f.path) })
    if (out.length > 50000) break
  }
  return out
}

function findMediaId(abs: string): number | undefined {
  const l = ctx.library
  if (!l) return undefined
  const s = l.toStored(abs)
  return l.db.value<number>('SELECT id FROM media WHERE in_library = ? AND path = ?', s.inLibrary, s.path)
}

export function fromMedia(ids: number[]): ConvertJobItem[] {
  const l = lib()
  return l.db
    .all<{ id: number; path: string; in_library: number }>(
      'SELECT id, path, in_library FROM media WHERE kind = 1 AND id IN (SELECT value FROM json_each(?))',
      jsonIds(ids)
    )
    .map((r) => ({ path: l.resolve(r.path, r.in_library), mediaId: r.id }))
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

function applyNaming(pattern: string, input: string, index: number, total: number, date: number, fmt: string): string {
  const name = basename(input, extname(input))
  const d = new Date(date)
  const width = Math.max(3, String(total).length)
  const out = (pattern || '{name}')
    .replace(/\{name\}/g, name)
    .replace(/\{n\}/g, pad(index + 1, width))
    .replace(/\{date\}/g, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    .replace(/\{format\}/g, fmt)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
  return out || name
}

export function startConvert(items: ConvertJobItem[], opts: ConvertOptions): number {
  const jobId = nextJob++
  const state = { cancelled: false }
  jobs.set(jobId, state)
  void run(jobId, state, items, opts)
  return jobId
}

export function cancelConvert(jobId: number): void {
  const s = jobs.get(jobId)
  if (s) s.cancelled = true
}

async function run(jobId: number, state: { cancelled: boolean }, items: ConvertJobItem[], opts: ConvertOptions): Promise<void> {
  const progress: ConvertProgress = {
    jobId, done: 0, total: items.length, failed: 0, finished: false, cancelled: false, outputs: [], errors: [], outputBytes: 0, inputBytes: 0
  }
  let lastEmit = 0
  const report = (force = false): void => {
    const now = Date.now()
    if (force || now - lastEmit > 120) {
      lastEmit = now
      emit('convert:progress', { ...progress, outputs: progress.finished ? progress.outputs : [] })
    }
  }
  report(true)
  const ext = opts.format === 'jpeg' ? 'jpg' : opts.format === 'tiff' ? 'tif' : opts.format
  const reserved = new Set<string>()
  const l = ctx.library
  const concurrency = Math.max(1, pool().capacity())
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length && !state.cancelled) {
      const i = next++
      const item = items[i]
      progress.current = basename(item.path)
      try {
        const st = await stat(item.path)
        let rotation = 0
        let date = st.mtimeMs
        if (item.mediaId && l) {
          const r = l.db.get<{ rotation: number; sort_date: number }>('SELECT rotation, sort_date FROM media WHERE id = ?', item.mediaId)
          if (r) {
            rotation = r.rotation
            date = r.sort_date
          }
        }
        const dir =
          opts.destination === 'custom' && opts.customDir
            ? opts.customDir
            : opts.destination === 'subfolder'
              ? join(dirname(item.path), opts.subfolderName || 'Converted')
              : dirname(item.path)
        const base = applyNaming(opts.naming, item.path, i, items.length, date, opts.format)
        const output = uniquePath(join(dir, `${base}.${ext}`), new Set([...reserved, item.path]))
        reserved.add(output)
        const r = await pool().run<{ bytes: number }>(
          'convert',
          {
            input: item.path,
            ext: extOf(item.path),
            output,
            format: opts.format,
            quality: opts.quality,
            resize: opts.resize,
            resizeValue: opts.resizeValue,
            keepMetadata: opts.keepMetadata,
            stripLocation: opts.stripLocation,
            rotation
          },
          LANE_IMPORT
        )
        progress.outputs.push(output)
        progress.outputBytes += r.bytes
        progress.inputBytes += st.size
      } catch (err) {
        progress.failed++
        progress.errors.push({ path: item.path, reason: (err as Error).message })
      }
      progress.done++
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  progress.finished = true
  progress.cancelled = state.cancelled
  progress.current = undefined
  jobs.delete(jobId)
  if (opts.addToLibrary && progress.outputs.length && ctx.importer) {
    ctx.importer.start({ paths: progress.outputs, mode: 'reference' }, true)
  }
  report(true)
}
