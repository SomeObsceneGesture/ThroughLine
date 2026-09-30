// Forgiving search-query parser. Plain words match filenames, folders, tags,
// albums and camera names; recognised words (years, month names, "videos",
// "heic", "4k"...) additionally match the corresponding structured field.
// Explicit operators (tag:, album:, ext:, rating>=4, before:2024 ...) are
// supported for power users but never required.

import type { MediaKind } from './types'
import { IMAGE_EXTENSIONS, RAW_IMAGE, VIDEO } from './formats'

export interface SearchTerm {
  text: string
  year?: number
  month?: number
  kind?: MediaKind
  exts?: string[]
  favorite?: boolean
  orientation?: 'portrait' | 'landscape' | 'square'
  minLongEdge?: number
}

export interface Comparison {
  op: '>' | '>=' | '<' | '<=' | '='
  value: number
}

export interface ParsedSearch {
  terms: SearchTerm[]
  exclude: string[]
  tags: string[]
  albums: string[]
  folders: string[]
  names: string[]
  cameras: string[]
  exts: string[]
  kinds: MediaKind[]
  years: number[]
  months: number[]
  rating?: Comparison
  size?: Comparison
  favorite?: boolean
  orientation?: 'portrait' | 'landscape' | 'square'
  minLongEdge?: number
  after?: number
  before?: number
  empty: boolean
}

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]

const MONTH_ALIASES: Record<string, number> = {}
MONTHS.forEach((m, i) => {
  MONTH_ALIASES[m] = i + 1
  MONTH_ALIASES[m.slice(0, 3)] = i + 1
})
MONTH_ALIASES['sept'] = 9

const KIND_WORDS: Record<string, MediaKind> = {
  photo: 'photo', photos: 'photo', image: 'photo', images: 'photo', picture: 'photo', pictures: 'photo', pics: 'photo',
  video: 'video', videos: 'video', movie: 'video', movies: 'video', clip: 'video', clips: 'video', film: 'video', films: 'video'
}

const EXT_GROUPS: Record<string, string[]> = {
  jpg: ['jpg', 'jpeg', 'jpe', 'jfif'],
  jpeg: ['jpg', 'jpeg', 'jpe', 'jfif'],
  tif: ['tif', 'tiff'],
  tiff: ['tif', 'tiff'],
  heic: ['heic', 'heif', 'hif'],
  heif: ['heic', 'heif', 'hif'],
  raw: [...RAW_IMAGE],
  mov: ['mov', 'qt'],
  mp4: ['mp4', 'm4v']
}

const RESOLUTION_WORDS: Record<string, number> = {
  '8k': 7680, '5k': 5120, '4k': 3840, uhd: 3840, '2k': 2048, '1440p': 2560, '1080p': 1920, fhd: 1920, hd: 1280, '720p': 1280
}

const ORIENTATION_WORDS: Record<string, 'portrait' | 'landscape' | 'square'> = {
  portrait: 'portrait', vertical: 'portrait', landscape: 'landscape', horizontal: 'landscape', square: 'square', panorama: 'landscape'
}

const FAVORITE_WORDS = new Set(['favorite', 'favorites', 'favourite', 'favourites', 'fav', 'favs', '♥', '❤'])

function extGroup(word: string): string[] | undefined {
  if (EXT_GROUPS[word]) return EXT_GROUPS[word]
  if (IMAGE_EXTENSIONS.has(word) || VIDEO.has(word)) return [word]
  return undefined
}

/** Split into tokens, keeping quoted phrases (including key:"quoted value") together. */
export function tokenize(input: string): string[] {
  const out: string[] = []
  const re = /(-?[\w.#★]+[:<>=]+"[^"]*"?)|(-?"[^"]*"?)|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[0])
  return out
}

function unquote(s: string): string {
  return s.replace(/^"/, '').replace(/"$/, '')
}

function parseComparison(raw: string, scale = 1): Comparison | undefined {
  const m = /^(>=|<=|>|<|=)?\s*([\d.]+)\s*(kb|mb|gb|k|m|g)?$/i.exec(raw.trim())
  if (!m) return undefined
  let value = parseFloat(m[2])
  const unit = (m[3] ?? '').toLowerCase()
  if (unit.startsWith('k')) value *= 1024
  else if (unit.startsWith('m')) value *= 1024 ** 2
  else if (unit.startsWith('g')) value *= 1024 ** 3
  else value *= scale
  return { op: (m[1] as Comparison['op']) ?? '=', value }
}

/** Parse a date like 2026, 2026-09, 2026-09-14 into a [start, end) range in local time. */
export function parseDateRange(s: string): [number, number] | undefined {
  const m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/.exec(s)
  if (!m) return undefined
  const y = +m[1]
  if (m[3]) {
    const start = new Date(y, +m[2] - 1, +m[3]).getTime()
    return [start, new Date(y, +m[2] - 1, +m[3] + 1).getTime()]
  }
  if (m[2]) return [new Date(y, +m[2] - 1, 1).getTime(), new Date(y, +m[2], 1).getTime()]
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]
}

export function parseSearch(input: string): ParsedSearch {
  const r: ParsedSearch = {
    terms: [], exclude: [], tags: [], albums: [], folders: [], names: [], cameras: [],
    exts: [], kinds: [], years: [], months: [], empty: true
  }
  for (const tokenRaw of tokenize(input.trim())) {
    let token = tokenRaw
    if (!token) continue
    if (token.startsWith('-') && token.length > 1) {
      r.exclude.push(unquote(token.slice(1)).toLowerCase())
      continue
    }
    if (token.startsWith('#') && token.length > 1) {
      r.tags.push(unquote(token.slice(1)).toLowerCase())
      continue
    }
    if (/^★+$/.test(token)) {
      r.rating = { op: '>=', value: token.length }
      continue
    }
    const op = /^([a-z]+)(:|>=|<=|>|<|=)(.*)$/i.exec(token)
    if (op) {
      const key = op[1].toLowerCase()
      const sep = op[2]
      const value = unquote(op[3])
      const lower = value.toLowerCase()
      const cmp = sep === ':' ? value : sep + value
      let handled = true
      switch (key) {
        case 'tag': case 'tags': r.tags.push(lower); break
        case 'album': r.albums.push(lower); break
        case 'folder': case 'in': case 'path': r.folders.push(lower); break
        case 'name': case 'file': case 'filename': r.names.push(lower); break
        case 'camera': case 'lens': case 'make': case 'model': r.cameras.push(lower); break
        case 'ext': case 'format': case 'extension': {
          const g = extGroup(lower.replace(/^\./, ''))
          r.exts.push(...(g ?? [lower.replace(/^\./, '')]))
          break
        }
        case 'type': case 'kind': case 'is': {
          if (KIND_WORDS[lower]) r.kinds.push(KIND_WORDS[lower])
          else if (FAVORITE_WORDS.has(lower)) r.favorite = true
          else if (ORIENTATION_WORDS[lower]) r.orientation = ORIENTATION_WORDS[lower]
          else if (extGroup(lower)) r.exts.push(...extGroup(lower)!)
          else handled = false
          break
        }
        case 'year': {
          const y = parseInt(lower, 10)
          if (y > 1800 && y < 2200) r.years.push(y)
          else handled = false
          break
        }
        case 'month': {
          const mo = MONTH_ALIASES[lower] ?? parseInt(lower, 10)
          if (mo >= 1 && mo <= 12) r.months.push(mo)
          else handled = false
          break
        }
        case 'date': case 'on': {
          const range = parseDateRange(lower)
          if (range) { r.after = range[0]; r.before = range[1] } else handled = false
          break
        }
        case 'after': case 'since': case 'from': {
          const range = parseDateRange(lower)
          if (range) r.after = range[sep.includes('=') ? 0 : 1]
          else handled = false
          break
        }
        case 'before': case 'until': case 'to': {
          const range = parseDateRange(lower)
          if (range) r.before = range[key === 'until' || key === 'to' ? 1 : 0]
          else handled = false
          break
        }
        case 'rating': case 'stars': case 'star': case 'rated': {
          const c = parseComparison(cmp)
          if (c) r.rating = c.op === '=' && sep === ':' ? { op: '>=', value: c.value } : c
          else handled = false
          break
        }
        case 'size': {
          const c = parseComparison(cmp, 1024 * 1024)
          if (c) r.size = c.op === '=' ? { op: '>=', value: c.value } : c
          else handled = false
          break
        }
        case 'res': case 'resolution': {
          const w = RESOLUTION_WORDS[lower] ?? parseInt(lower, 10)
          if (w > 0) r.minLongEdge = w
          else handled = false
          break
        }
        default: handled = false
      }
      if (handled) { r.empty = false; continue }
      token = tokenRaw
    }

    const text = unquote(token).toLowerCase()
    if (!text) continue
    const term: SearchTerm = { text }
    const n = /^\d{4}$/.test(text) ? parseInt(text, 10) : NaN
    if (n > 1800 && n < 2200) term.year = n
    if (MONTH_ALIASES[text]) term.month = MONTH_ALIASES[text]
    if (KIND_WORDS[text]) term.kind = KIND_WORDS[text]
    const exts = extGroup(text)
    if (exts) term.exts = exts
    if (FAVORITE_WORDS.has(text)) term.favorite = true
    if (ORIENTATION_WORDS[text]) term.orientation = ORIENTATION_WORDS[text]
    if (RESOLUTION_WORDS[text]) term.minLongEdge = RESOLUTION_WORDS[text]
    r.terms.push(term)
  }
  r.empty =
    r.terms.length === 0 && r.exclude.length === 0 && r.tags.length === 0 && r.albums.length === 0 &&
    r.folders.length === 0 && r.names.length === 0 && r.cameras.length === 0 && r.exts.length === 0 &&
    r.kinds.length === 0 && r.years.length === 0 && r.months.length === 0 && !r.rating && !r.size &&
    r.favorite === undefined && !r.orientation && !r.minLongEdge && r.after === undefined && r.before === undefined
  return r
}

/** Text indexed for a media item. Lowercase, space separated. */
export function buildSearchText(parts: {
  filename: string
  folderPath?: string | null
  tags?: string[]
  albums?: string[]
  camera?: string | null
  lens?: string | null
  ext: string
  kind: MediaKind
  sortDate: number
}): string {
  const d = new Date(parts.sortDate)
  const month = MONTHS[d.getMonth()]
  return [
    parts.filename,
    parts.folderPath ?? '',
    ...(parts.tags ?? []).map((t) => `#${t}`),
    ...(parts.albums ?? []),
    parts.camera ?? '',
    parts.lens ?? '',
    parts.ext,
    parts.kind,
    String(d.getFullYear()),
    month
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase()
}
