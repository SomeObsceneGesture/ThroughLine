// Folder tree: every directory that contains media, plus its ancestors up to
// the import root. Mirrors the real filesystem structure for the Folders view.

import { basename, dirname, relative, sep, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Library } from './library'
import type { FolderNode } from '@shared/types'
import { ids as jsonIds } from './db'

interface FolderRow {
  id: number
  path: string
  in_library: number
  parent_id: number | null
  name: string
  is_root: number
  display: string
}

export class FolderIndex {
  private cache = new Map<string, number>()

  constructor(private lib: Library) {}

  private key(stored: string, inLib: number): string {
    return `${inLib}:${stored}`
  }

  private lookup(stored: string, inLib: number): number | undefined {
    const k = this.key(stored, inLib)
    let id = this.cache.get(k)
    if (id === undefined) {
      id = this.lib.db.value<number>('SELECT id FROM folders WHERE in_library = ? AND path = ?', inLib, stored)
      if (id !== undefined) this.cache.set(k, id)
    }
    return id
  }

  /**
   * Ensure rows exist for `dir` and each ancestor up to `root` (inclusive).
   * Returns the folder id for `dir`.
   */
  ensure(dir: string, root: string): number {
    const { path: stored, inLibrary } = this.lib.toStored(dir)
    const existing = this.lookup(stored, inLibrary)
    if (existing !== undefined) return existing

    const isRoot = dir === root || !isInside(dir, root)
    let parentId: number | null = null
    let display: string
    if (!isRoot) {
      parentId = this.ensure(dirname(dir), root)
      const parentDisplay = this.lib.db.value<string>('SELECT display FROM folders WHERE id = ?', parentId) ?? ''
      display = `${parentDisplay}/${basename(dir)}`
    } else {
      // A new root may sit inside an existing tree (attach it) or contain
      // existing roots (adopt them).
      const parent = this.findAncestorFolder(dir)
      if (parent) {
        return this.ensure(dir, parent.abs)
      }
      display = basename(dir) || dir
    }
    const r = this.lib.db.run(
      'INSERT INTO folders(path, in_library, parent_id, name, is_root, display) VALUES (?, ?, ?, ?, ?, ?)',
      stored,
      inLibrary,
      parentId,
      basename(dir) || dir,
      isRoot ? 1 : 0,
      display.toLowerCase()
    )
    const id = r.lastInsertRowid
    this.cache.set(this.key(stored, inLibrary), id)
    if (isRoot) this.adoptChildren(id, dir)
    return id
  }

  private findAncestorFolder(dir: string): { id: number; abs: string } | undefined {
    let cur = dirname(dir)
    let prev = dir
    while (cur !== prev) {
      const { path, inLibrary } = this.lib.toStored(cur)
      const id = this.lookup(path, inLibrary)
      if (id !== undefined) return { id, abs: cur }
      prev = cur
      cur = dirname(cur)
    }
    return undefined
  }

  private adoptChildren(id: number, dir: string): void {
    const roots = this.lib.db.all<FolderRow>('SELECT * FROM folders WHERE is_root = 1 AND id != ?', id)
    for (const r of roots) {
      const abs = this.lib.resolve(r.path, r.in_library)
      if (!isInside(abs, dir) || abs === dir) continue
      // Build the intermediate chain between `dir` and the old root.
      const parentId = this.ensure(dirname(abs), dir)
      this.lib.db.run('UPDATE folders SET parent_id = ?, is_root = 0 WHERE id = ?', parentId, r.id)
      this.refreshDisplay(r.id)
    }
  }

  /** Recompute display paths for a folder and its descendants. */
  refreshDisplay(id: number): void {
    this.lib.db.run(
      `WITH RECURSIVE chain(id, display) AS (
         SELECT f.id, COALESCE((SELECT display FROM folders p WHERE p.id = f.parent_id) || '/', '') || lower(f.name)
         FROM folders f WHERE f.id = ?
         UNION ALL
         SELECT c.id, chain.display || '/' || lower(c.name) FROM folders c JOIN chain ON c.parent_id = chain.id
       )
       UPDATE folders SET display = (SELECT display FROM chain WHERE chain.id = folders.id)
       WHERE id IN (SELECT id FROM chain)`,
      id
    )
  }

  clearCache(): void {
    this.cache.clear()
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[a-zA-Z]:/.test(rel) && !rel.startsWith(sep))
}

export function tree(lib: Library): FolderNode[] {
  const rows = lib.db.all<FolderRow & { count: number }>(
    `SELECT f.*, (SELECT count(*) FROM media m WHERE m.folder_id = f.id AND m.deleted_at IS NULL) AS count
     FROM folders f ORDER BY f.name COLLATE NOCASE`
  )
  const rootsChecked = new Map<number, boolean>()
  const nodes: FolderNode[] = rows.map((r) => {
    const abs = lib.resolve(r.path, r.in_library)
    let offline = false
    if (r.is_root && !r.in_library) {
      if (!rootsChecked.has(r.id)) rootsChecked.set(r.id, !existsSync(abs))
      offline = rootsChecked.get(r.id)!
    }
    return {
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      path: abs,
      count: r.count,
      isRoot: !!r.is_root,
      inLibrary: !!r.in_library,
      offline
    }
  })
  // Drop empty branches (folders with no media anywhere below them).
  const children = new Map<number | null, FolderNode[]>()
  for (const n of nodes) {
    const list = children.get(n.parentId) ?? []
    list.push(n)
    children.set(n.parentId, list)
  }
  const total = new Map<number, number>()
  const sum = (n: FolderNode): number => {
    let t = n.count
    for (const c of children.get(n.id) ?? []) t += sum(c)
    total.set(n.id, t)
    return t
  }
  const present = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    if (n.parentId !== null && !present.has(n.parentId)) n.parentId = null
    if (n.parentId === null) sum(n)
  }
  return nodes.filter((n) => (total.get(n.id) ?? 0) > 0)
}

export function subtreeIds(lib: Library, ids: number[]): number[] {
  return lib.db
    .all<{ id: number }>(
      `WITH RECURSIVE sub(id) AS (SELECT value FROM json_each(?) UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id) SELECT id FROM sub`,
      jsonIds(ids)
    )
    .map((r) => r.id)
}

export function folderAbsPath(lib: Library, id: number): string | null {
  const r = lib.db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id)
  return r ? lib.resolve(r.path, r.in_library) : null
}

export function mediaInFolders(lib: Library, folderIds: number[]): number[] {
  const all = subtreeIds(lib, folderIds)
  return lib.db
    .all<{ id: number }>('SELECT id FROM media WHERE folder_id IN (SELECT value FROM json_each(?))', jsonIds(all))
    .map((r) => r.id)
}

/** Remove folder rows that no longer contain media anywhere below them. */
export function pruneEmpty(lib: Library): void {
  for (let pass = 0; pass < 32; pass++) {
    const r = lib.db.run(
      `DELETE FROM folders WHERE id NOT IN (SELECT DISTINCT folder_id FROM media WHERE folder_id IS NOT NULL)
       AND id NOT IN (SELECT DISTINCT parent_id FROM folders WHERE parent_id IS NOT NULL)`
    )
    if (r.changes === 0) break
  }
  // Promote orphans (whose parent disappeared) to roots.
  lib.db.run('UPDATE folders SET is_root = 1 WHERE parent_id IS NULL AND is_root = 0')
}

export function relocate(lib: Library, id: number, newPath: string): { changed: number } {
  const f = lib.db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id)
  if (!f) throw new Error('Folder not found')
  if (f.in_library) throw new Error('Folders inside the library cannot be relocated')
  const oldPath = f.path
  const sub = subtreeIds(lib, [id])
  let changed = 0
  lib.db.tx(() => {
    const folders = lib.db.all<FolderRow>('SELECT * FROM folders WHERE id IN (SELECT value FROM json_each(?))', jsonIds(sub))
    for (const row of folders) {
      const rel = relative(oldPath, row.path)
      const np = rel ? join(newPath, rel) : newPath
      lib.db.run('UPDATE folders SET path = ? WHERE id = ?', np, row.id)
      if (row.id === id) lib.db.run('UPDATE folders SET name = ? WHERE id = ?', basename(newPath), row.id)
    }
    const media = lib.db.all<{ id: number; path: string }>(
      'SELECT id, path FROM media WHERE in_library = 0 AND folder_id IN (SELECT value FROM json_each(?))',
      jsonIds(sub)
    )
    for (const m of media) {
      const rel = relative(oldPath, m.path)
      const np = join(newPath, rel)
      lib.db.run('UPDATE media SET path = ?, missing = ? WHERE id = ?', np, existsSync(np) ? 0 : 1, m.id)
      changed++
    }
  })
  new FolderIndex(lib).refreshDisplay(id)
  return { changed }
}
