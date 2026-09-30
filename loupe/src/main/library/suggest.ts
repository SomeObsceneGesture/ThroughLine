// Search-as-you-type suggestions: tags, albums, folders, dates, types, cameras.

import { lib } from '../context'
import { MONTHS } from '@shared/search'
import type { SearchSuggestion } from '@shared/types'

const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s)

export function suggest(text: string): SearchSuggestion[] {
  const l = lib()
  const m = /(\S*)$/.exec(text)
  const raw = (m?.[1] ?? '').toLowerCase()
  const t = raw.replace(/^#/, '').replace(/^(tag|album|folder|in|camera|type):/, '')
  if (!t) return []
  const out: SearchSuggestion[] = []
  const like = `%${t}%`
  const prefix = `${t}%`
  const wantAll = !raw.includes(':')
  if (wantAll || raw.startsWith('#') || raw.startsWith('tag:')) {
    for (const r of l.db.all<{ id: number; name: string; n: number }>(
      `SELECT t.id, t.name, (SELECT count(*) FROM media_tags mt JOIN media m ON m.id = mt.media_id WHERE mt.tag_id = t.id AND m.deleted_at IS NULL) AS n
       FROM tags t WHERE t.name LIKE ? ORDER BY (t.name LIKE ?) DESC, n DESC LIMIT 4`,
      like,
      prefix
    ))
      out.push({ kind: 'tag', label: r.name, token: /\s/.test(r.name) ? `tag:"${r.name}"` : `#${r.name}`, id: r.id, count: r.n })
  }
  if (raw.startsWith('#')) return out
  if (wantAll || raw.startsWith('album:')) {
    for (const r of l.db.all<{ id: number; name: string; n: number }>(
      `SELECT a.id, a.name, (SELECT count(*) FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = a.id AND m.deleted_at IS NULL) AS n
       FROM albums a WHERE a.name LIKE ? ORDER BY (a.name LIKE ?) DESC, n DESC LIMIT 3`,
      like,
      prefix
    ))
      out.push({ kind: 'album', label: r.name, token: `album:${quote(r.name)}`, id: r.id, count: r.n })
  }
  if (wantAll || raw.startsWith('folder:') || raw.startsWith('in:')) {
    for (const r of l.db.all<{ id: number; name: string; display: string }>(
      `SELECT id, name, display FROM folders WHERE name LIKE ? ORDER BY (name LIKE ?) DESC, length(display) LIMIT 3`,
      like,
      prefix
    ))
      out.push({ kind: 'folder', label: r.name, detail: r.display, token: `folder:${quote(r.name.toLowerCase())}`, id: r.id })
  }
  if (wantAll && /^\d{1,4}$/.test(t)) {
    for (const r of l.db.all<{ year: number; n: number }>(
      `SELECT year, count(*) AS n FROM media WHERE deleted_at IS NULL AND CAST(year AS TEXT) LIKE ? GROUP BY year ORDER BY year DESC LIMIT 3`,
      prefix
    ))
      out.push({ kind: 'year', label: String(r.year), token: String(r.year), count: r.n })
  }
  if (wantAll && t.length >= 2) {
    const mi = MONTHS.findIndex((mo) => mo.startsWith(t))
    if (mi >= 0) {
      const n = l.db.value<number>('SELECT count(*) FROM media WHERE deleted_at IS NULL AND month = ?', mi + 1) ?? 0
      if (n) out.push({ kind: 'month', label: MONTHS[mi][0].toUpperCase() + MONTHS[mi].slice(1), detail: 'any year', token: MONTHS[mi], count: n })
    }
    for (const [word, token, label] of [
      ['videos', 'type:video', 'Videos'],
      ['photos', 'type:photo', 'Photos'],
      ['raw', 'ext:raw', 'RAW files'],
      ['heic', 'ext:heic', 'HEIC photos'],
      ['favorites', 'is:favorite', 'Favorites'],
      ['portrait', 'is:portrait', 'Portrait orientation'],
      ['landscape', 'is:landscape', 'Landscape orientation']
    ] as const) {
      if (word.startsWith(t)) out.push({ kind: 'type', label, token })
    }
  }
  if (wantAll || raw.startsWith('camera:')) {
    for (const r of l.db.all<{ camera: string; n: number }>(
      `SELECT camera, count(*) AS n FROM media WHERE deleted_at IS NULL AND camera LIKE ? GROUP BY camera ORDER BY n DESC LIMIT 2`,
      like
    ))
      out.push({ kind: 'camera', label: r.camera, token: `camera:${quote(r.camera)}`, count: r.n })
  }
  return out.slice(0, 10)
}
