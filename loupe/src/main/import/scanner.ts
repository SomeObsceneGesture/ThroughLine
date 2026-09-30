// Streaming directory walker for imports. Yields supported media files in
// batches so the first items appear in the library within a second, even for
// folders with tens of thousands of files.

import { opendir, stat } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { extOf, kindOfExt } from '@shared/formats'
import type { MediaKind } from '@shared/types'

export interface ScannedFile {
  path: string
  size: number
  mtime: number
  ext: string
  kind: MediaKind
  /** The folder the user dropped (or the parent of a dropped file). */
  root: string
  /** Whether the user dropped the containing folder (vs. loose files). */
  fromFolder: boolean
}

const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', '@eadir', '.thumbnails', 'node_modules', '__macosx',
  '.trash', '.trashes', '.spotlight-v100', '.fseventsd', '.ds_store', 'lost+found'
])

export interface ScanOptions {
  /** Absolute directories whose contents must never be imported (library internals). */
  exclude: string[]
  signal?: { cancelled: boolean }
  onUnsupported?: () => void
  onDir?: () => void
}

export async function* scan(paths: string[], opts: ScanOptions, batchSize = 256): AsyncGenerator<ScannedFile[]> {
  let batch: ScannedFile[] = []
  const excluded = new Set(opts.exclude.map((p) => p.toLowerCase()))

  const push = function* (f: ScannedFile): Generator<ScannedFile[]> {
    batch.push(f)
    if (batch.length >= batchSize) {
      const out = batch
      batch = []
      yield out
    }
  }

  for (const p of paths) {
    if (opts.signal?.cancelled) return
    let st
    try {
      st = await stat(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      const ext = extOf(p)
      const kind = kindOfExt(ext)
      if (!kind) {
        opts.onUnsupported?.()
        continue
      }
      yield* push({ path: p, size: st.size, mtime: st.mtimeMs, ext, kind, root: dirname(p), fromFolder: false })
      continue
    }
    if (!st.isDirectory()) continue
    const root = p
    const stack = [p]
    while (stack.length) {
      if (opts.signal?.cancelled) return
      const dir = stack.pop()!
      if (excluded.has(dir.toLowerCase())) continue
      opts.onDir?.()
      let handle
      try {
        handle = await opendir(dir, { bufferSize: 256 })
      } catch {
        continue
      }
      const subdirs: string[] = []
      for await (const ent of handle) {
        const name = ent.name
        if (name.startsWith('.') || name.startsWith('._')) continue
        const full = join(dir, name)
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(name.toLowerCase())) subdirs.push(full)
          continue
        }
        if (!ent.isFile()) continue
        const ext = extOf(name)
        const kind = kindOfExt(ext)
        if (!kind) {
          opts.onUnsupported?.()
          continue
        }
        let fst
        try {
          fst = await stat(full)
        } catch {
          continue
        }
        if (fst.size === 0) continue
        yield* push({ path: full, size: fst.size, mtime: fst.mtimeMs, ext, kind, root, fromFolder: true })
      }
      // Depth-first in natural name order.
      subdirs.sort((a, b) => basename(b).localeCompare(basename(a), undefined, { numeric: true }))
      stack.push(...subdirs)
    }
  }
  if (batch.length) yield batch
}
