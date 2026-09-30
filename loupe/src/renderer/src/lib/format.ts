// Human-friendly formatting.

import { formatLabel } from '@shared/formats'
import type { MediaItem } from '@shared/types'

export function bytes(n: number | null | undefined): string {
  if (!n) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function count(n: number, word: string, plural = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : plural}`
}

export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec)) return '0:00'
  sec = Math.max(0, sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' })
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export const date = (t: number | null | undefined): string => (t ? dateFmt.format(t) : '—')
export const dateTime = (t: number | null | undefined): string => (t ? dateTimeFmt.format(t) : '—')
export const longDate = (t: number): string => longDateFmt.format(t)
export const time = (t: number): string => timeFmt.format(t)
export const monthName = (t: number): string => monthFmt.format(t)
export const monthYear = (t: number): string => monthYearFmt.format(t)

export function relative(t: number | null | undefined): string {
  if (!t) return 'never'
  const diff = Date.now() - t
  const min = 60_000, hour = 60 * min, day = 24 * hour
  if (diff < min) return 'just now'
  if (diff < hour) return `${Math.floor(diff / min)} min ago`
  if (diff < day) return `${Math.floor(diff / hour)} h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`
  return date(t)
}

export function resolution(w: number | null | undefined, h: number | null | undefined, rotation = 0): string {
  if (!w || !h) return '—'
  if (rotation % 180 !== 0) [w, h] = [h, w]
  return `${w.toLocaleString()} × ${h.toLocaleString()}`
}

export function megapixels(w: number | null, h: number | null): string {
  if (!w || !h) return ''
  const mp = (w * h) / 1e6
  return mp >= 1 ? `${mp.toFixed(mp >= 10 ? 0 : 1)} MP` : ''
}

export function exposure(t: number | undefined): string {
  if (!t) return ''
  if (t >= 1) return `${t.toFixed(t >= 10 ? 0 : 1)}s`
  return `1/${Math.round(1 / t)}s`
}

export function typeLabel(m: Pick<MediaItem, 'ext' | 'kind'>): string {
  return formatLabel(m.ext)
}

export function videoRes(w: number | null, h: number | null): string {
  if (!w || !h) return ''
  const short = Math.min(w, h)
  if (short >= 4320) return '8K'
  if (short >= 2160) return '4K'
  if (short >= 1440) return '1440p'
  if (short >= 1080) return '1080p'
  if (short >= 720) return '720p'
  return `${short}p`
}

export function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function dirName(p: string): string {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join(p.includes('\\') && !p.includes('/') ? '\\' : '/')
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function extOfName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i) : ''
}
