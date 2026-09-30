// Read-side queries over the media table: view/search → SQL, the compact
// layout index, lazily-fetched item details and the search index.

import type { Library } from './library'
import { ids as jsonIds, type Param } from './db'
import { parseSearch, buildSearchText, type ParsedSearch } from '@shared/search'
import {
  FLAG_FAVORITE, FLAG_MISSING, FLAG_THUMB, FLAG_THUMB_FAILED, FLAG_VIDEO,
  type LayoutResult, type LibraryCounts, type MediaDetails, type MediaItem, type MediaKind,
  type MediaMetadata, type MediaQuery
} from '@shared/types'

export const KIND_PHOTO = 1
export const KIND_VIDEO = 2
export const kindName = (k: number): MediaKind => (k === KIND_VIDEO ? 'video' : 'photo')
export const kindCode = (k: MediaKind): number => (k === 'video' ? KIND_VIDEO : KIND_PHOTO)

const DAY = 86_400_000
export const RECENT_WINDOW = 30 * DAY

interface Built {
  with: string
  join: string
  where: string[]
  params: Param[]
  withParams: Param[]
  order: string
  limit: string
}

function likeTerm(text: string): { clause: string; param: string } {
  // FTS5's trigram tokenizer accelerates LIKE; wildcard characters in the
  // user's text are matched literally via instr() instead.
  if (/[%_]/.test(text)) return { clause: 'instr(text, ?) > 0', param: text }
  return { clause: 'text LIKE ?', param: `%${text}%` }
}

const orientationSql: Record<string, string> = {
  portrait: `(CASE WHEN m.rotation IN (90, 270) THEN m.width > m.height ELSE m.height > m.width END)`,
  landscape: `(CASE WHEN m.rotation IN (90, 270) THEN m.height > m.width ELSE m.width > m.height END)`,
  square: `(m.width = m.height)`
}

function applySearch(b: Built, s: ParsedSearch): void {
  for (const term of s.terms) {
    const ors: string[] = []
    const like = likeTerm(term.text)
    ors.push(`m.id IN (SELECT rowid FROM media_fts WHERE ${like.clause})`)
    b.params.push(like.param)
    if (term.year) { ors.push('m.year = ?'); b.params.push(term.year) }
    if (term.month) { ors.push('m.month = ?'); b.params.push(term.month) }
    if (term.kind) { ors.push('m.kind = ?'); b.params.push(kindCode(term.kind)) }
    if (term.exts?.length) {
      ors.push(`m.ext IN (SELECT value FROM json_each(?))`)
      b.params.push(JSON.stringify(term.exts))
    }
    if (term.favorite) ors.push('m.favorite = 1')
    if (term.orientation) ors.push(orientationSql[term.orientation])
    if (term.minLongEdge) { ors.push('MAX(m.width, m.height) >= ?'); b.params.push(term.minLongEdge) }
    b.where.push(`(${ors.join(' OR ')})`)
  }
  for (const text of s.exclude) {
    const like = likeTerm(text)
    b.where.push(`m.id NOT IN (SELECT rowid FROM media_fts WHERE ${like.clause})`)
    b.params.push(like.param)
  }
  for (const tag of s.tags) {
    b.where.push(`m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name LIKE ?)`)
    b.params.push(`${tag}%`)
  }
  for (const album of s.albums) {
    b.where.push(`m.id IN (SELECT ai.media_id FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE a.name LIKE ?)`)
    b.params.push(`%${album}%`)
  }
  for (const folder of s.folders) {
    b.where.push(`m.folder_id IN (SELECT id FROM folders WHERE display LIKE ?)`)
    b.params.push(`%${folder}%`)
  }
  for (const name of s.names) {
    b.where.push('m.filename LIKE ?')
    b.params.push(`%${name}%`)
  }
  for (const cam of s.cameras) {
    b.where.push(`(m.camera LIKE ? OR json_extract(m.metadata, '$.lens') LIKE ?)`)
    b.params.push(`%${cam}%`, `%${cam}%`)
  }
  if (s.exts.length) {
    b.where.push('m.ext IN (SELECT value FROM json_each(?))')
    b.params.push(JSON.stringify(s.exts))
  }
  if (s.kinds.length) {
    b.where.push('m.kind IN (SELECT value FROM json_each(?))')
    b.params.push(JSON.stringify(s.kinds.map(kindCode)))
  }
  if (s.years.length) {
    b.where.push('m.year IN (SELECT value FROM json_each(?))')
    b.params.push(JSON.stringify(s.years))
  }
  if (s.months.length) {
    b.where.push('m.month IN (SELECT value FROM json_each(?))')
    b.params.push(JSON.stringify(s.months))
  }
  if (s.rating) {
    b.where.push(`m.rating ${s.rating.op} ?`)
    b.params.push(s.rating.value)
  }
  if (s.size) {
    b.where.push(`m.size ${s.size.op} ?`)
    b.params.push(s.size.value)
  }
  if (s.favorite) b.where.push('m.favorite = 1')
  if (s.orientation) b.where.push(orientationSql[s.orientation])
  if (s.minLongEdge) {
    b.where.push('MAX(m.width, m.height) >= ?')
    b.params.push(s.minLongEdge)
  }
  if (s.after !== undefined) {
    b.where.push('m.sort_date >= ?')
    b.params.push(s.after)
  }
  if (s.before !== undefined) {
    b.where.push('m.sort_date < ?')
    b.params.push(s.before)
  }
}

function build(q: MediaQuery): Built {
  const b: Built = { with: '', join: '', where: [], params: [], withParams: [], order: '', limit: '' }
  const v = q.view
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC'
  if (v.type === 'deleted') b.where.push('m.deleted_at IS NOT NULL')
  else b.where.push('m.deleted_at IS NULL')

  let manualOrder = false
  switch (v.type) {
    case 'photos': b.where.push('m.kind = 1'); break
    case 'videos': b.where.push('m.kind = 2'); break
    case 'favorites': b.where.push('m.favorite = 1'); break
    case 'recent-added':
      b.where.push('m.added_at >= (SELECT MAX(added_at) FROM media WHERE deleted_at IS NULL) - ?')
      b.params.push(RECENT_WINDOW)
      break
    case 'recent-viewed':
      b.where.push('m.last_viewed_at IS NOT NULL')
      b.limit = 'LIMIT 1000'
      break
    case 'album':
      b.join = 'JOIN album_items ai ON ai.media_id = m.id AND ai.album_id = ?'
      b.withParams.push(v.id)
      manualOrder = true
      break
    case 'tag':
      b.where.push('m.id IN (SELECT media_id FROM media_tags WHERE tag_id = ?)')
      b.params.push(v.id)
      break
    case 'folder':
      if (v.recursive) {
        b.with = `WITH RECURSIVE sub(id) AS (SELECT value FROM json_each(?) UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)`
        b.withParams.unshift(jsonIds(v.ids))
        b.where.push('m.folder_id IN (SELECT id FROM sub)')
      } else {
        b.where.push('m.folder_id IN (SELECT value FROM json_each(?))')
        b.params.push(jsonIds(v.ids))
      }
      break
    case 'import':
      b.where.push('m.import_id = ?')
      b.params.push(v.id)
      break
  }

  if (q.search && q.search.trim()) {
    const parsed = parseSearch(q.search)
    if (!parsed.empty) applySearch(b, parsed)
  }

  switch (q.sort) {
    case 'added': b.order = `m.added_at ${dir}, m.id ${dir}`; break
    case 'name': b.order = `m.filename COLLATE NOCASE ${dir}, m.id ${dir}`; break
    case 'size': b.order = `m.size ${dir}, m.id ${dir}`; break
    case 'rating': b.order = `m.rating ${dir}, m.sort_date DESC, m.id DESC`; break
    case 'type': b.order = `m.kind ${dir}, m.ext ${dir}, m.sort_date DESC, m.id DESC`; break
    case 'viewed': b.order = `m.last_viewed_at ${dir}, m.id ${dir}`; break
    case 'manual':
      b.order = manualOrder ? `ai.position ${dir}` : `m.sort_date DESC, m.id DESC`
      break
    default: b.order = `m.sort_date ${dir}, m.id ${dir}`
  }
  if (v.type === 'deleted') b.order = `m.deleted_at DESC, m.id DESC`
  return b
}

function sqlFor(q: MediaQuery, select: string): { sql: string; params: Param[] } {
  const b = build(q)
  const sql = `${b.with} SELECT ${select} FROM media m ${b.join} WHERE ${b.where.join(' AND ')} ORDER BY ${b.order} ${b.limit}`
  return { sql, params: [...b.withParams, ...b.params] }
}

interface LayoutRow {
  id: number
  width: number | null
  height: number | null
  rotation: number
  d: number
  thumb_state: number
  kind: number
  favorite: number
  missing: number
}

export function layout(lib: Library, q: MediaQuery): LayoutResult {
  const t0 = performance.now()
  const dateCol = q.sort === 'added' ? 'm.added_at' : q.sort === 'viewed' ? 'm.last_viewed_at' : q.view.type === 'deleted' ? 'm.deleted_at' : 'm.sort_date'
  const { sql, params } = sqlFor(q, `m.id, m.width, m.height, m.rotation, ${dateCol} AS d, m.thumb_state, m.kind, m.favorite, m.missing`)
  const rows = lib.db.all<LayoutRow>(sql, ...params)
  const n = rows.length
  const out: LayoutResult = {
    ids: new Int32Array(n),
    ratios: new Float32Array(n),
    dates: new Float64Array(n),
    flags: new Uint8Array(n),
    total: n,
    queryMs: 0
  }
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    out.ids[i] = r.id
    const quarter = ((r.rotation / 90) | 0) & 3
    let ratio = r.width && r.height ? r.width / r.height : r.kind === KIND_VIDEO ? 16 / 9 : 1
    if (quarter & 1) ratio = 1 / ratio
    out.ratios[i] = Math.min(Math.max(ratio, 0.2), 6)
    out.dates[i] = r.d ?? 0
    out.flags[i] =
      (r.thumb_state === 1 ? FLAG_THUMB : 0) |
      (r.thumb_state === 2 ? FLAG_THUMB_FAILED : 0) |
      (r.kind === KIND_VIDEO ? FLAG_VIDEO : 0) |
      (r.favorite ? FLAG_FAVORITE : 0) |
      (r.missing ? FLAG_MISSING : 0) |
      (quarter << 5)
  }
  out.queryMs = performance.now() - t0
  return out
}

export function idsForQuery(lib: Library, q: MediaQuery): number[] {
  const { sql, params } = sqlFor(q, 'm.id')
  return lib.db.all<{ id: number }>(sql, ...params).map((r) => r.id)
}

export interface MediaRow {
  id: number
  kind: number
  path: string
  in_library: number
  folder_id: number | null
  filename: string
  ext: string
  size: number
  mtime: number
  taken_at: number | null
  sort_date: number
  added_at: number
  width: number | null
  height: number | null
  duration: number | null
  orientation: number | null
  rotation: number
  favorite: number
  rating: number
  quick_hash: string | null
  full_hash: string | null
  phash: string | null
  thumb_state: number
  thumb_version: number
  error: string | null
  metadata: string | null
  camera: string | null
  last_viewed_at: number | null
  deleted_at: number | null
  missing: number
  import_id: number | null
  tag_names?: string | null
  folder_name?: string | null
}

const ITEM_SELECT = `
  m.*, f.name AS folder_name,
  (SELECT group_concat(t.name, char(31)) FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = m.id) AS tag_names`

export function toItem(lib: Library, r: MediaRow): MediaItem {
  return {
    id: r.id,
    kind: kindName(r.kind),
    filename: r.filename,
    ext: r.ext,
    path: lib.resolve(r.path, r.in_library),
    inLibrary: !!r.in_library,
    folderId: r.folder_id,
    size: r.size,
    mtime: r.mtime,
    takenAt: r.taken_at,
    sortDate: r.sort_date,
    addedAt: r.added_at,
    width: r.width,
    height: r.height,
    duration: r.duration,
    rotation: r.rotation,
    favorite: !!r.favorite,
    rating: r.rating,
    thumbState: r.thumb_state,
    thumbVersion: r.thumb_version,
    missing: !!r.missing,
    lastViewedAt: r.last_viewed_at,
    deletedAt: r.deleted_at,
    error: r.error,
    tags: r.tag_names ? r.tag_names.split('\x1f').sort((a, b) => a.localeCompare(b)) : [],
    folderName: r.folder_name ?? null
  }
}

export function items(lib: Library, list: number[]): MediaItem[] {
  if (!list.length) return []
  const rows = lib.db.all<MediaRow>(
    `SELECT ${ITEM_SELECT} FROM media m LEFT JOIN folders f ON f.id = m.folder_id WHERE m.id IN (SELECT value FROM json_each(?))`,
    jsonIds(list)
  )
  return rows.map((r) => toItem(lib, r))
}

export function row(lib: Library, id: number): MediaRow | undefined {
  return lib.db.get<MediaRow>('SELECT * FROM media WHERE id = ?', id)
}

export function details(lib: Library, id: number): MediaDetails | null {
  const r = lib.db.get<MediaRow>(
    `SELECT ${ITEM_SELECT} FROM media m LEFT JOIN folders f ON f.id = m.folder_id WHERE m.id = ?`,
    id
  )
  if (!r) return null
  const base = toItem(lib, r)
  let metadata: MediaMetadata = {}
  try {
    metadata = r.metadata ? JSON.parse(r.metadata) : {}
  } catch {
    metadata = {}
  }
  const albums = lib.db.all<{ id: number; name: string }>(
    'SELECT a.id, a.name FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = ? ORDER BY a.name COLLATE NOCASE',
    id
  )
  const tagList = lib.db.all<{ id: number; name: string }>(
    'SELECT t.id, t.name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = ? ORDER BY t.name COLLATE NOCASE',
    id
  )
  const folder = r.folder_id ? lib.db.get<{ path: string; in_library: number }>('SELECT path, in_library FROM folders WHERE id = ?', r.folder_id) : undefined
  let duplicateOf: number[] | undefined
  if (r.full_hash) {
    duplicateOf = lib.db
      .all<{ id: number }>('SELECT id FROM media WHERE full_hash = ? AND id != ? AND deleted_at IS NULL', r.full_hash, id)
      .map((x) => x.id)
  }
  return {
    ...base,
    metadata,
    albums,
    tagList,
    folderPath: folder ? lib.resolve(folder.path, folder.in_library) : null,
    duplicateOf: duplicateOf?.length ? duplicateOf : undefined
  }
}

export function counts(lib: Library): LibraryCounts {
  const r = lib.db.get<Record<string, number>>(`
    SELECT
      count(*) FILTER (WHERE deleted_at IS NULL) AS all_count,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind = 1) AS photos,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind = 2) AS videos,
      count(*) FILTER (WHERE deleted_at IS NULL AND favorite = 1) AS favorites,
      count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
      count(*) FILTER (WHERE deleted_at IS NULL AND last_viewed_at IS NOT NULL) AS viewed,
      MAX(added_at) FILTER (WHERE deleted_at IS NULL) AS last_added
    FROM media`)!
  const recentAdded = r.last_added
    ? (lib.db.value<number>(
        'SELECT count(*) FROM media WHERE deleted_at IS NULL AND added_at >= ?',
        r.last_added - RECENT_WINDOW
      ) ?? 0)
    : 0
  return {
    all: r.all_count ?? 0,
    photos: r.photos ?? 0,
    videos: r.videos ?? 0,
    favorites: r.favorites ?? 0,
    deleted: r.deleted ?? 0,
    recentAdded,
    recentViewed: Math.min(r.viewed ?? 0, 1000)
  }
}

interface SearchRow {
  id: number
  filename: string
  ext: string
  kind: number
  sort_date: number
  camera: string | null
  lens: string | null
  folder: string | null
  tags: string | null
  albums: string | null
}

/** Rebuild the search-index rows for the given media ids. */
export function updateSearchText(lib: Library, list: number[]): void {
  if (!list.length) return
  const CHUNK = 2000
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = jsonIds(list.slice(i, i + CHUNK))
    const rows = lib.db.all<SearchRow>(
      `SELECT m.id, m.filename, m.ext, m.kind, m.sort_date, m.camera,
         json_extract(m.metadata, '$.lens') AS lens, f.display AS folder,
         (SELECT group_concat(t.name, char(31)) FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = m.id) AS tags,
         (SELECT group_concat(a.name, char(31)) FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.media_id = m.id) AS albums
       FROM media m LEFT JOIN folders f ON f.id = m.folder_id
       WHERE m.id IN (SELECT value FROM json_each(?))`,
      chunk
    )
    lib.db.tx(() => {
      lib.db.run('DELETE FROM media_fts WHERE rowid IN (SELECT value FROM json_each(?))', chunk)
      for (const r of rows) {
        lib.db.run(
          'INSERT INTO media_fts(rowid, text) VALUES (?, ?)',
          r.id,
          buildSearchText({
            filename: r.filename,
            folderPath: r.folder,
            tags: r.tags ? r.tags.split('\x1f') : [],
            albums: r.albums ? r.albums.split('\x1f') : [],
            camera: r.camera,
            lens: r.lens,
            ext: r.ext,
            kind: kindName(r.kind),
            sortDate: r.sort_date
          })
        )
      }
    })
  }
}

export function mediaIdsForTag(lib: Library, tagId: number): number[] {
  return lib.db.all<{ media_id: number }>('SELECT media_id FROM media_tags WHERE tag_id = ?', tagId).map((r) => r.media_id)
}

export function mediaIdsForAlbum(lib: Library, albumId: number): number[] {
  return lib.db.all<{ media_id: number }>('SELECT media_id FROM album_items WHERE album_id = ?', albumId).map((r) => r.media_id)
}
