// Write-side operations. Every reversible change records an undo entry;
// file operations never overwrite existing files.

import { rename as fsRename, copyFile, unlink, stat, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { shell } from 'electron'
import { ctx, lib } from '../context'
import { history } from './history'
import { ids as jsonIds, type Row } from './db'
import { updateSearchText, mediaIdsForTag, mediaIdsForAlbum } from './media-repo'
import { FolderIndex, mediaInFolders, pruneEmpty, subtreeIds } from './folders'
import { uniquePath } from '../import/importer'
import type { Album } from '@shared/types'

const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

function touched(ids: number[], structural = true): void {
  ctx.changes.items(ids)
  if (structural) ctx.changes.structure()
}

// ─── simple flags ───────────────────────────────────────────────────────────

function snapshotColumn(col: 'favorite' | 'rating' | 'rotation' | 'deleted_at', ids: number[]): Map<number, number | null> {
  const rows = lib().db.all<{ id: number; v: number | null }>(
    `SELECT id, ${col} AS v FROM media WHERE id IN (SELECT value FROM json_each(?))`,
    jsonIds(ids)
  )
  return new Map(rows.map((r) => [r.id, r.v]))
}

function restoreColumn(col: 'favorite' | 'rating' | 'rotation' | 'deleted_at', snap: Map<number, number | null>): void {
  const l = lib()
  l.db.tx(() => {
    for (const [id, v] of snap) l.db.run(`UPDATE media SET ${col} = ? WHERE id = ?`, v, id)
  })
  touched([...snap.keys()])
}

export function setFavorite(ids: number[], value: boolean): void {
  if (!ids.length) return
  const snap = snapshotColumn('favorite', ids)
  const apply = (): void => {
    lib().db.run('UPDATE media SET favorite = ? WHERE id IN (SELECT value FROM json_each(?))', value ? 1 : 0, jsonIds(ids))
    touched(ids)
  }
  apply()
  history.push({
    label: `${value ? 'Favorite' : 'Unfavorite'} ${plural(ids.length, 'item')}`,
    undo: () => restoreColumn('favorite', snap),
    redo: apply
  })
}

export function setRating(ids: number[], rating: number): void {
  if (!ids.length) return
  rating = Math.max(0, Math.min(5, Math.round(rating)))
  const snap = snapshotColumn('rating', ids)
  const apply = (): void => {
    lib().db.run('UPDATE media SET rating = ? WHERE id IN (SELECT value FROM json_each(?))', rating, jsonIds(ids))
    touched(ids, false)
  }
  apply()
  history.push({
    label: rating ? `Rate ${plural(ids.length, 'item')} ${rating}★` : `Clear rating`,
    undo: () => restoreColumn('rating', snap),
    redo: apply
  })
}

export function rotate(ids: number[], delta: number): void {
  if (!ids.length) return
  const apply = (d: number) => (): void => {
    lib().db.run(
      'UPDATE media SET rotation = ((rotation + ?) % 360 + 360) % 360 WHERE id IN (SELECT value FROM json_each(?))',
      d,
      jsonIds(ids)
    )
    touched(ids, false)
  }
  apply(delta)()
  history.push({ label: `Rotate ${plural(ids.length, 'item')}`, undo: apply(-delta), redo: apply(delta) })
}

// ─── deletion ───────────────────────────────────────────────────────────────

export function trash(ids: number[]): number {
  const l = lib()
  const live = l.db
    .all<{ id: number }>('SELECT id FROM media WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))', jsonIds(ids))
    .map((r) => r.id)
  if (!live.length) return 0
  const now = Date.now()
  const apply = (): void => {
    l.db.run('UPDATE media SET deleted_at = ? WHERE id IN (SELECT value FROM json_each(?))', now, jsonIds(live))
    touched(live)
  }
  apply()
  history.push({
    label: `Move ${plural(live.length, 'item')} to Recently Deleted`,
    undo: () => {
      l.db.run('UPDATE media SET deleted_at = NULL WHERE id IN (SELECT value FROM json_each(?))', jsonIds(live))
      touched(live)
    },
    redo: apply
  })
  return live.length
}

export function restore(ids: number[]): number {
  const l = lib()
  const snap = snapshotColumn('deleted_at', ids)
  const r = l.db.run('UPDATE media SET deleted_at = NULL WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NOT NULL', jsonIds(ids))
  touched(ids)
  history.push({
    label: `Restore ${plural(r.changes, 'item')}`,
    undo: () => restoreColumn('deleted_at', snap),
    redo: () => {
      l.db.run('UPDATE media SET deleted_at = NULL WHERE id IN (SELECT value FROM json_each(?))', jsonIds(ids))
      touched(ids)
    }
  })
  return r.changes
}

async function removeGenerated(id: number): Promise<void> {
  const l = lib()
  await rm(l.thumbPath(id), { force: true }).catch(() => undefined)
  await rm(l.previewPath(id), { force: true }).catch(() => undefined)
  await rm(l.cachePath('storyboards', `${id}.jpg`), { force: true }).catch(() => undefined)
  await rm(l.cachePath('playable', `${id}.mp4`), { force: true }).catch(() => undefined)
}

/**
 * Permanently remove items from the library. With moveFilesToTrash the files
 * go to the operating system's Trash/Recycle Bin (recoverable there);
 * otherwise files are left untouched on disk.
 */
export async function deletePermanently(ids: number[], moveFilesToTrash: boolean): Promise<{ removed: number; trashed: number; errors: string[] }> {
  const l = lib()
  const rows = l.db.all<{ id: number; path: string; in_library: number }>(
    'SELECT id, path, in_library FROM media WHERE id IN (SELECT value FROM json_each(?))',
    jsonIds(ids)
  )
  const errors: string[] = []
  let trashed = 0
  const removable: number[] = []
  for (const r of rows) {
    const abs = l.resolve(r.path, r.in_library)
    if (moveFilesToTrash && existsSync(abs)) {
      try {
        await shell.trashItem(abs)
        trashed++
      } catch (err) {
        errors.push(`${basename(abs)}: ${(err as Error).message}`)
        continue
      }
    }
    removable.push(r.id)
  }
  l.db.tx(() => {
    l.db.run('DELETE FROM media_fts WHERE rowid IN (SELECT value FROM json_each(?))', jsonIds(removable))
    l.db.run('DELETE FROM media WHERE id IN (SELECT value FROM json_each(?))', jsonIds(removable))
    pruneEmpty(l)
  })
  for (const id of removable) await removeGenerated(id)
  touched(removable)
  return { removed: removable.length, trashed, errors }
}

// ─── rename / move ──────────────────────────────────────────────────────────

const INVALID_NAME = /[\\/:*?"<>|\x00-\x1f]/

export async function renameMedia(id: number, requested: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const l = lib()
  const row = l.db.get<{ path: string; in_library: number; filename: string; ext: string }>(
    'SELECT path, in_library, filename, ext FROM media WHERE id = ?',
    id
  )
  if (!row) return { ok: false, error: 'Item not found' }
  let name = requested.trim()
  if (!name) return { ok: false, error: 'The name can’t be empty.' }
  if (INVALID_NAME.test(name)) return { ok: false, error: 'Names can’t contain \\ / : * ? " < > |' }
  const origExt = extname(row.filename)
  if (extname(name).toLowerCase() !== origExt.toLowerCase()) name += origExt
  if (name === row.filename) return { ok: true, name }
  const from = l.resolve(row.path, row.in_library)
  const to = join(dirname(from), name)
  if (existsSync(to) && to.toLowerCase() !== from.toLowerCase()) return { ok: false, error: `A file named “${name}” already exists in this folder.` }
  const doRename = async (a: string, b: string): Promise<void> => {
    await fsRename(a, b)
    const stored = l.toStored(b)
    l.db.run('UPDATE media SET path = ?, filename = ? WHERE id = ?', stored.path, basename(b), id)
    updateSearchText(l, [id])
    touched([id], false)
  }
  try {
    await doRename(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? 'The file couldn’t be found. It may have been moved.' : code === 'EACCES' || code === 'EPERM' ? 'Permission denied.' : (err as Error).message }
  }
  history.push({
    label: `Rename to “${name}”`,
    undo: () => doRename(to, from),
    redo: () => doRename(from, to)
  })
  return { ok: true, name }
}

async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await fsRename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    // Different drive: copy, verify, then remove the source.
    await copyFile(from, to, 1 /* COPYFILE_EXCL */)
    const [a, b] = await Promise.all([stat(from), stat(to)])
    if (a.size !== b.size) {
      await unlink(to).catch(() => undefined)
      throw new Error('Copy verification failed')
    }
    await unlink(from)
  }
}

export async function moveMedia(ids: number[], destDir: string): Promise<{ moved: number; errors: string[] }> {
  const l = lib()
  const rows = l.db.all<{ id: number; path: string; in_library: number; folder_id: number | null }>(
    'SELECT id, path, in_library, folder_id FROM media WHERE id IN (SELECT value FROM json_each(?))',
    jsonIds(ids)
  )
  const folders = new FolderIndex(l)
  const done: { id: number; from: string; to: string; folderId: number | null }[] = []
  const errors: string[] = []
  const reserved = new Set<string>()
  for (const r of rows) {
    const from = l.resolve(r.path, r.in_library)
    if (dirname(from) === destDir) continue
    const to = uniquePath(join(destDir, basename(from)), reserved)
    reserved.add(to)
    try {
      await moveFile(from, to)
      const stored = l.toStored(to)
      const folderId = folders.ensure(destDir, destDir)
      l.db.run('UPDATE media SET path = ?, in_library = ?, filename = ?, folder_id = ?, missing = 0 WHERE id = ?', stored.path, stored.inLibrary, basename(to), folderId, r.id)
      done.push({ id: r.id, from, to, folderId: r.folder_id })
    } catch (err) {
      errors.push(`${basename(from)}: ${(err as Error).message}`)
    }
  }
  if (!done.length) return { moved: 0, errors }
  const movedIds = done.map((d) => d.id)
  pruneEmpty(l)
  updateSearchText(l, movedIds)
  touched(movedIds)
  history.push({
    label: `Move ${plural(done.length, 'item')}`,
    undo: async () => {
      for (const d of done) {
        if (existsSync(d.from)) continue
        try {
          await moveFile(d.to, d.from)
          const stored = l.toStored(d.from)
          const fid = d.folderId && l.db.value('SELECT id FROM folders WHERE id = ?', d.folderId) ? d.folderId : folders.ensure(dirname(d.from), dirname(d.from))
          l.db.run('UPDATE media SET path = ?, in_library = ?, filename = ?, folder_id = ? WHERE id = ?', stored.path, stored.inLibrary, basename(d.from), fid, d.id)
        } catch {
          /* leave where it is */
        }
      }
      pruneEmpty(l)
      updateSearchText(l, movedIds)
      touched(movedIds)
    },
    redo: async () => {
      for (const d of done) {
        if (existsSync(d.to)) continue
        try {
          await moveFile(d.from, d.to)
          const stored = l.toStored(d.to)
          l.db.run('UPDATE media SET path = ?, in_library = ?, filename = ?, folder_id = ? WHERE id = ?', stored.path, stored.inLibrary, basename(d.to), folders.ensure(destDir, destDir), d.id)
        } catch {
          /* ignore */
        }
      }
      pruneEmpty(l)
      updateSearchText(l, movedIds)
      touched(movedIds)
    }
  })
  return { moved: done.length, errors }
}

// ─── tags ───────────────────────────────────────────────────────────────────

function tagId(name: string, create: boolean): { id: number; created: boolean } | null {
  const l = lib()
  const existing = l.db.value<number>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', name)
  if (existing !== undefined) return { id: existing, created: false }
  if (!create) return null
  return { id: l.db.run('INSERT INTO tags(name, created_at) VALUES (?, ?)', name, Date.now()).lastInsertRowid, created: true }
}

export function cleanTagName(n: string): string {
  return n.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function addTags(mediaIds: number[], names: string[]): number {
  const l = lib()
  const clean = [...new Set(names.map(cleanTagName).filter(Boolean))]
  if (!clean.length || !mediaIds.length) return 0
  const added: [number, number][] = []
  const createdTags: number[] = []
  l.db.tx(() => {
    for (const name of clean) {
      const t = tagId(name, true)!
      if (t.created) createdTags.push(t.id)
      for (const m of mediaIds) {
        const r = l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', m, t.id)
        if (r.changes) added.push([m, t.id])
      }
    }
  })
  updateSearchText(l, mediaIds)
  touched(mediaIds)
  const createdNames = new Map(createdTags.map((id) => [id, l.db.value<string>('SELECT name FROM tags WHERE id = ?', id)!]))
  history.push({
    label: `Tag ${plural(mediaIds.length, 'item')} “${clean.join(', ')}”`,
    undo: () => {
      l.db.tx(() => {
        for (const [m, t] of added) l.db.run('DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?', m, t)
        for (const t of createdTags) l.db.run('DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM media_tags WHERE tag_id = ?)', t, t)
      })
      updateSearchText(l, mediaIds)
      touched(mediaIds)
    },
    redo: () => {
      l.db.tx(() => {
        for (const [id, name] of createdNames) l.db.run('INSERT OR IGNORE INTO tags(id, name, created_at) VALUES (?, ?, ?)', id, name, Date.now())
        for (const [m, t] of added) l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', m, t)
      })
      updateSearchText(l, mediaIds)
      touched(mediaIds)
    }
  })
  return added.length
}

export function removeTags(mediaIds: number[], tagIds: number[]): number {
  const l = lib()
  const pairs = l.db.all<{ media_id: number; tag_id: number }>(
    'SELECT media_id, tag_id FROM media_tags WHERE media_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT value FROM json_each(?))',
    jsonIds(mediaIds),
    jsonIds(tagIds)
  )
  if (!pairs.length) return 0
  const apply = (): void => {
    l.db.tx(() => {
      for (const p of pairs) l.db.run('DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?', p.media_id, p.tag_id)
    })
    updateSearchText(l, mediaIds)
    touched(mediaIds)
  }
  apply()
  const names = tagIds.map((t) => l.db.value<string>('SELECT name FROM tags WHERE id = ?', t)).filter(Boolean)
  history.push({
    label: `Remove tag “${names.join(', ')}”`,
    undo: () => {
      l.db.tx(() => {
        for (const p of pairs) l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', p.media_id, p.tag_id)
      })
      updateSearchText(l, mediaIds)
      touched(mediaIds)
    },
    redo: apply
  })
  return pairs.length
}

export function renameTag(id: number, requested: string): { ok: boolean; error?: string } {
  const l = lib()
  const name = cleanTagName(requested)
  if (!name) return { ok: false, error: 'Tag names can’t be empty.' }
  const old = l.db.get<{ name: string; created_at: number }>('SELECT name, created_at FROM tags WHERE id = ?', id)
  if (!old) return { ok: false, error: 'Tag not found' }
  const clash = l.db.value<number>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?', name, id)
  const members = mediaIdsForTag(l, id)
  if (clash !== undefined) {
    // Merge into the existing tag.
    const targetHad = new Set(mediaIdsForTag(l, clash))
    const apply = (): void => {
      l.db.tx(() => {
        for (const m of members) l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', m, clash)
        l.db.run('DELETE FROM tags WHERE id = ?', id)
      })
      updateSearchText(l, members)
      touched(members)
    }
    apply()
    history.push({
      label: `Merge tag “${old.name}” into “${name}”`,
      undo: () => {
        l.db.tx(() => {
          l.db.run('INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)', id, old.name, old.created_at)
          for (const m of members) {
            l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', m, id)
            if (!targetHad.has(m)) l.db.run('DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?', m, clash)
          }
        })
        updateSearchText(l, members)
        touched(members)
      },
      redo: apply
    })
    return { ok: true }
  }
  const set = (n: string) => (): void => {
    l.db.run('UPDATE tags SET name = ? WHERE id = ?', n, id)
    updateSearchText(l, members)
    touched(members)
  }
  set(name)()
  history.push({ label: `Rename tag to “${name}”`, undo: set(old.name), redo: set(name) })
  return { ok: true }
}

export function deleteTag(id: number): void {
  const l = lib()
  const old = l.db.get<{ name: string; created_at: number }>('SELECT name, created_at FROM tags WHERE id = ?', id)
  if (!old) return
  const members = mediaIdsForTag(l, id)
  const apply = (): void => {
    l.db.run('DELETE FROM tags WHERE id = ?', id)
    updateSearchText(l, members)
    touched(members)
  }
  apply()
  history.push({
    label: `Delete tag “${old.name}”`,
    undo: () => {
      l.db.tx(() => {
        l.db.run('INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)', id, old.name, old.created_at)
        for (const m of members) l.db.run('INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?, ?)', m, id)
      })
      updateSearchText(l, members)
      touched(members)
    },
    redo: apply
  })
}

// ─── albums ─────────────────────────────────────────────────────────────────

export function albumRow(id: number): Album | null {
  const r = lib().db.get<Row>(
    `SELECT a.*, (SELECT count(*) FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = a.id AND m.deleted_at IS NULL) AS count
     FROM albums a WHERE a.id = ?`,
    id
  )
  if (!r) return null
  return {
    id: r.id as number,
    name: r.name as string,
    count: r.count as number,
    coverId: (r.cover_media_id as number) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number
  }
}

export function uniqueAlbumName(base: string): string {
  const l = lib()
  let name = base.trim() || 'Untitled Album'
  if (!l.db.value('SELECT 1 FROM albums WHERE name = ? COLLATE NOCASE', name)) return name
  for (let i = 2; ; i++) {
    const c = `${name} ${i}`
    if (!l.db.value('SELECT 1 FROM albums WHERE name = ? COLLATE NOCASE', c)) return c
  }
}

function insertAlbumItems(albumId: number, mediaIds: number[]): number[] {
  const l = lib()
  const base = l.db.value<number>('SELECT COALESCE(MAX(position), 0) FROM album_items WHERE album_id = ?', albumId) ?? 0
  const now = Date.now()
  const added: number[] = []
  let pos = base
  for (const m of mediaIds) {
    const r = l.db.run('INSERT OR IGNORE INTO album_items(album_id, media_id, position, added_at) VALUES (?, ?, ?, ?)', albumId, m, ++pos, now)
    if (r.changes) added.push(m)
  }
  l.db.run('UPDATE albums SET updated_at = ? WHERE id = ?', now, albumId)
  return added
}

export function createAlbum(name: string, mediaIds: number[] = []): Album {
  const l = lib()
  const now = Date.now()
  const finalName = uniqueAlbumName(name)
  let id = 0
  const apply = (): void => {
    l.db.tx(() => {
      const order = (l.db.value<number>('SELECT COALESCE(MAX(sort_order), 0) FROM albums') ?? 0) + 1
      if (id) l.db.run('INSERT INTO albums(id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?)', id, finalName, now, now, order)
      else id = l.db.run('INSERT INTO albums(name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?)', finalName, now, now, order).lastInsertRowid
      if (mediaIds.length) insertAlbumItems(id, mediaIds)
    })
    if (mediaIds.length) updateSearchText(l, mediaIds)
    touched(mediaIds)
  }
  apply()
  history.push({
    label: `Create album “${finalName}”`,
    undo: () => {
      l.db.run('DELETE FROM albums WHERE id = ?', id)
      if (mediaIds.length) updateSearchText(l, mediaIds)
      touched(mediaIds)
    },
    redo: apply
  })
  return albumRow(id)!
}

export function renameAlbum(id: number, name: string): void {
  const l = lib()
  const old = l.db.value<string>('SELECT name FROM albums WHERE id = ?', id)
  const clean = name.trim()
  if (old === undefined || !clean || clean === old) return
  const members = mediaIdsForAlbum(l, id)
  const set = (n: string) => (): void => {
    l.db.run('UPDATE albums SET name = ?, updated_at = ? WHERE id = ?', n, Date.now(), id)
    updateSearchText(l, members)
    touched(members)
  }
  set(clean)()
  history.push({ label: `Rename album to “${clean}”`, undo: set(old), redo: set(clean) })
}

export function deleteAlbum(id: number): void {
  const l = lib()
  const row = l.db.get<Row>('SELECT * FROM albums WHERE id = ?', id)
  if (!row) return
  const items = l.db.all<{ media_id: number; position: number; added_at: number }>('SELECT media_id, position, added_at FROM album_items WHERE album_id = ?', id)
  const members = items.map((i) => i.media_id)
  const apply = (): void => {
    l.db.run('DELETE FROM albums WHERE id = ?', id)
    updateSearchText(l, members)
    touched(members)
  }
  apply()
  history.push({
    label: `Delete album “${row.name as string}”`,
    undo: () => {
      l.db.tx(() => {
        l.db.run(
          'INSERT INTO albums(id, name, created_at, updated_at, cover_media_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          id, row.name as string, row.created_at as number, row.updated_at as number, (row.cover_media_id as number) ?? null, row.sort_order as number
        )
        for (const it of items) l.db.run('INSERT OR IGNORE INTO album_items(album_id, media_id, position, added_at) VALUES (?, ?, ?, ?)', id, it.media_id, it.position, it.added_at)
      })
      updateSearchText(l, members)
      touched(members)
    },
    redo: apply
  })
}

export function addToAlbum(id: number, mediaIds: number[]): number {
  const l = lib()
  const name = l.db.value<string>('SELECT name FROM albums WHERE id = ?', id)
  if (name === undefined) throw new Error('Album not found')
  let added: number[] = []
  l.db.tx(() => {
    added = insertAlbumItems(id, mediaIds)
  })
  if (!added.length) return 0
  updateSearchText(l, added)
  touched(added)
  const snapshot = added
  history.push({
    label: `Add ${plural(snapshot.length, 'item')} to “${name}”`,
    undo: () => {
      l.db.run('DELETE FROM album_items WHERE album_id = ? AND media_id IN (SELECT value FROM json_each(?))', id, jsonIds(snapshot))
      updateSearchText(l, snapshot)
      touched(snapshot)
    },
    redo: () => {
      l.db.tx(() => insertAlbumItems(id, snapshot))
      updateSearchText(l, snapshot)
      touched(snapshot)
    }
  })
  return added.length
}

export function removeFromAlbum(id: number, mediaIds: number[]): number {
  const l = lib()
  const name = l.db.value<string>('SELECT name FROM albums WHERE id = ?', id)
  const items = l.db.all<{ media_id: number; position: number; added_at: number }>(
    'SELECT media_id, position, added_at FROM album_items WHERE album_id = ? AND media_id IN (SELECT value FROM json_each(?))',
    id,
    jsonIds(mediaIds)
  )
  if (!items.length) return 0
  const members = items.map((i) => i.media_id)
  const apply = (): void => {
    l.db.run('DELETE FROM album_items WHERE album_id = ? AND media_id IN (SELECT value FROM json_each(?))', id, jsonIds(members))
    updateSearchText(l, members)
    touched(members)
  }
  apply()
  history.push({
    label: `Remove ${plural(members.length, 'item')} from “${name}”`,
    undo: () => {
      l.db.tx(() => {
        for (const it of items) l.db.run('INSERT OR IGNORE INTO album_items(album_id, media_id, position, added_at) VALUES (?, ?, ?, ?)', id, it.media_id, it.position, it.added_at)
      })
      updateSearchText(l, members)
      touched(members)
    },
    redo: apply
  })
  return members.length
}

export function reorderAlbum(id: number, moved: number[], beforeId: number | null): void {
  const l = lib()
  const current = l.db.all<{ media_id: number; position: number }>('SELECT media_id, position FROM album_items WHERE album_id = ? ORDER BY position', id)
  const snap = new Map(current.map((c) => [c.media_id, c.position]))
  const movedSet = new Set(moved)
  const rest = current.map((c) => c.media_id).filter((m) => !movedSet.has(m))
  const orderedMoved = current.map((c) => c.media_id).filter((m) => movedSet.has(m))
  let at = beforeId === null ? rest.length : rest.indexOf(beforeId)
  if (at < 0) at = rest.length
  const next = [...rest.slice(0, at), ...orderedMoved, ...rest.slice(at)]
  const apply = (order: number[]) => (): void => {
    l.db.tx(() => order.forEach((m, i) => l.db.run('UPDATE album_items SET position = ? WHERE album_id = ? AND media_id = ?', i + 1, id, m)))
    touched(order, false)
  }
  apply(next)()
  history.push({
    label: 'Reorder album',
    undo: () => {
      l.db.tx(() => {
        for (const [m, p] of snap) l.db.run('UPDATE album_items SET position = ? WHERE album_id = ? AND media_id = ?', p, id, m)
      })
      touched([...snap.keys()], false)
    },
    redo: apply(next)
  })
}

export function setAlbumCover(id: number, mediaId: number): void {
  lib().db.run('UPDATE albums SET cover_media_id = ? WHERE id = ?', mediaId, id)
  ctx.changes.structure()
}

// ─── folders ────────────────────────────────────────────────────────────────

interface Snapshot {
  folders: Row[]
  media: Row[]
  tags: Row[]
  albumItems: Row[]
}

function insertRow(table: string, row: Row): void {
  const cols = Object.keys(row)
  lib().db.run(`INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...(cols.map((c) => row[c]) as never[]))
}

/** Remove folders (and all media under them) from the library. Files stay on disk. */
export function removeFolders(folderIds: number[]): number {
  const l = lib()
  const sub = subtreeIds(l, folderIds)
  const media = mediaInFolders(l, folderIds)
  const snap: Snapshot = {
    folders: l.db.all<Row>('SELECT * FROM folders WHERE id IN (SELECT value FROM json_each(?))', jsonIds(sub)),
    media: l.db.all<Row>('SELECT * FROM media WHERE id IN (SELECT value FROM json_each(?))', jsonIds(media)),
    tags: l.db.all<Row>('SELECT * FROM media_tags WHERE media_id IN (SELECT value FROM json_each(?))', jsonIds(media)),
    albumItems: l.db.all<Row>('SELECT * FROM album_items WHERE media_id IN (SELECT value FROM json_each(?))', jsonIds(media))
  }
  const apply = (): void => {
    l.db.tx(() => {
      l.db.run('DELETE FROM media_fts WHERE rowid IN (SELECT value FROM json_each(?))', jsonIds(media))
      l.db.run('DELETE FROM media WHERE id IN (SELECT value FROM json_each(?))', jsonIds(media))
      l.db.run('DELETE FROM folders WHERE id IN (SELECT value FROM json_each(?))', jsonIds(sub))
      pruneEmpty(l)
    })
    touched(media)
  }
  apply()
  const names = snap.folders.filter((f) => folderIds.includes(f.id as number)).map((f) => f.name as string)
  history.push({
    label: `Remove ${names.length === 1 ? `“${names[0]}”` : plural(names.length, 'folder')} from library`,
    undo: () => {
      l.db.tx(() => {
        // Parents before children.
        const pending = [...snap.folders]
        const inserted = new Set<number>()
        for (let guard = 0; pending.length && guard < 1000; guard++) {
          for (let i = pending.length - 1; i >= 0; i--) {
            const f = pending[i]
            const parent = f.parent_id as number | null
            if (parent === null || inserted.has(parent) || l.db.value('SELECT 1 FROM folders WHERE id = ?', parent)) {
              insertRow('folders', f)
              inserted.add(f.id as number)
              pending.splice(i, 1)
            }
          }
        }
        for (const m of snap.media) insertRow('media', m)
        for (const t of snap.tags) insertRow('media_tags', t)
        for (const a of snap.albumItems) insertRow('album_items', a)
      })
      updateSearchText(l, media)
      touched(media)
    },
    redo: apply
  })
  return media.length
}
