// Gallery geometry. Computed from the compact layout index (aspect ratios and
// dates for every item) so any layout can be virtualised: only the rows or
// tiles intersecting the viewport are rendered.

import type { Density, InfoFields, LayoutMode } from '@shared/types'
import { monthYear } from './format'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Row {
  y: number
  h: number
  /** Item range [start, end) for item rows. */
  start: number
  end: number
  header?: { title: string; subtitle?: string; year?: number; first: number; count: number }
}

export interface Geometry {
  mode: LayoutMode
  totalHeight: number
  padX: number
  gap: number
  cols: number
  cellW: number
  cellH: number
  imageH: number
  captionH: number
  rows: Row[]
  /** Indices into `rows` of the item (non-header) rows, in order. */
  itemRows: Int32Array
  /** Masonry only: per-item positions. */
  mx?: Float32Array
  my?: Float32Array
  mh?: Float32Array
  columns?: Int32Array[]
  contain: boolean
}

export const DENSITY: Record<Density, { gap: number; pad: number }> = {
  compact: { gap: 2, pad: 12 },
  comfortable: { gap: 6, pad: 20 },
  spacious: { gap: 16, pad: 28 }
}

export function captionLines(info: InfoFields, mode: LayoutMode): number {
  if (mode === 'list' || mode === 'filmstrip') return 0
  let n = 0
  if (info.filename) n++
  if (info.date || info.type || info.resolution || info.size || info.folder) n++
  if (info.tags) n++
  return n
}

export interface GeometryInput {
  mode: LayoutMode
  width: number
  thumbSize: number
  density: Density
  info: InfoFields
  squareThumbs: boolean
  ratios: Float32Array
  dates: Float64Array
  count: number
  groupByDate: boolean
}

const TOP_PAD = 12

function itemRowsOf(rows: Row[]): Int32Array {
  const out: number[] = []
  rows.forEach((r, i) => {
    if (!r.header) out.push(i)
  })
  return Int32Array.from(out)
}

export function computeGeometry(g: GeometryInput): Geometry {
  const { gap, pad } = DENSITY[g.density]
  const width = Math.max(200, g.width)
  const lines = captionLines(g.info, g.mode)
  const captionH = lines ? 8 + lines * 17 : 0

  if (g.mode === 'list') {
    const rowH = 44
    const rows: Row[] = []
    for (let i = 0; i < g.count; i++) rows.push({ y: 40 + i * rowH, h: rowH, start: i, end: i + 1 })
    return { mode: g.mode, totalHeight: 40 + g.count * rowH + 24, padX: 0, gap: 0, cols: 1, cellW: width, cellH: rowH, imageH: rowH, captionH: 0, rows, itemRows: itemRowsOf(rows), contain: false }
  }

  if (g.mode === 'masonry') {
    const target = g.thumbSize * 1.25
    const cols = Math.max(1, Math.floor((width - 2 * pad + gap) / (target + gap)))
    const colW = (width - 2 * pad - (cols - 1) * gap) / cols
    const heights = new Float64Array(cols).fill(TOP_PAD)
    const mx = new Float32Array(g.count)
    const my = new Float32Array(g.count)
    const mh = new Float32Array(g.count)
    const colLists: number[][] = Array.from({ length: cols }, () => [])
    for (let i = 0; i < g.count; i++) {
      let c = 0
      for (let k = 1; k < cols; k++) if (heights[k] < heights[c] - 0.5) c = k
      const r = Math.min(Math.max(g.ratios[i] || 1, 0.33), 3)
      const h = colW / r + captionH
      mx[i] = pad + c * (colW + gap)
      my[i] = heights[c]
      mh[i] = h
      heights[c] += h + gap
      colLists[c].push(i)
    }
    const totalHeight = Math.max(...heights) + 24
    return {
      mode: g.mode, totalHeight, padX: pad, gap, cols, cellW: colW, cellH: 0, imageH: 0, captionH, rows: [], itemRows: new Int32Array(0),
      mx, my, mh, columns: colLists.map((l) => Int32Array.from(l)), contain: false
    }
  }

  const large = g.mode === 'large'
  const filmstrip = g.mode === 'filmstrip'
  const target = large ? g.thumbSize * 1.9 : filmstrip ? 96 : g.thumbSize
  const cols = filmstrip ? g.count : Math.max(1, Math.floor((width - 2 * pad + gap) / (target + gap)))
  const cellW = filmstrip ? 96 : (width - 2 * pad - (cols - 1) * gap) / cols
  const imageH = large ? cellW * 0.75 : cellW
  const cellH = imageH + captionH
  const rows: Row[] = []
  let y = TOP_PAD

  if (g.groupByDate && g.mode === 'timeline') {
    let i = 0
    let lastYear = NaN
    while (i < g.count) {
      const d = new Date(g.dates[i] || 0)
      const y0 = d.getFullYear(), m0 = d.getMonth()
      let j = i + 1
      while (j < g.count) {
        const dj = new Date(g.dates[j] || 0)
        if (dj.getFullYear() !== y0 || dj.getMonth() !== m0) break
        j++
      }
      const showYear = y0 !== lastYear
      lastYear = y0
      const headerH = showYear ? 72 : 48
      rows.push({
        y, h: headerH, start: i, end: i,
        header: { title: g.dates[i] ? monthYear(g.dates[i]) : 'Unknown date', year: showYear ? y0 : undefined, first: i, count: j - i }
      })
      y += headerH
      for (let k = i; k < j; k += cols) {
        rows.push({ y, h: cellH, start: k, end: Math.min(j, k + cols) })
        y += cellH + gap
      }
      y += 8
      i = j
    }
  } else {
    for (let k = 0; k < g.count; k += cols) {
      rows.push({ y, h: cellH, start: k, end: Math.min(g.count, k + cols) })
      y += cellH + gap
    }
  }
  return {
    mode: g.mode, totalHeight: y + 32, padX: pad, gap, cols, cellW, cellH, imageH, captionH, rows, itemRows: itemRowsOf(rows),
    contain: large || !g.squareThumbs
  }
}

/** First row index whose bottom edge is below `y`. */
function firstRowAt(rows: Row[], y: number): number {
  let lo = 0, hi = rows.length - 1, ans = rows.length
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].y + rows[mid].h >= y) {
      ans = mid
      hi = mid - 1
    } else lo = mid + 1
  }
  return ans
}

export function visibleRows(geo: Geometry, top: number, bottom: number): Row[] {
  const out: Row[] = []
  for (let i = firstRowAt(geo.rows, top); i < geo.rows.length && geo.rows[i].y <= bottom; i++) out.push(geo.rows[i])
  return out
}

export function visibleMasonry(geo: Geometry, top: number, bottom: number): number[] {
  const out: number[] = []
  if (!geo.columns || !geo.my || !geo.mh) return out
  for (const col of geo.columns) {
    let lo = 0, hi = col.length - 1, start = col.length
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const i = col[mid]
      if (geo.my[i] + geo.mh[i] >= top) {
        start = mid
        hi = mid - 1
      } else lo = mid + 1
    }
    for (let k = start; k < col.length && geo.my[col[k]] <= bottom; k++) out.push(col[k])
  }
  return out
}

function rowIndexOfItem(geo: Geometry, index: number): number {
  const ir = geo.itemRows
  let lo = 0, hi = ir.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = geo.rows[ir[mid]]
    if (index < r.start) hi = mid - 1
    else if (index >= r.end) lo = mid + 1
    else return ir[mid]
  }
  return -1
}

export function itemRect(geo: Geometry, index: number): Rect | null {
  if (geo.mode === 'masonry') {
    if (!geo.mx || index < 0 || index >= geo.mx.length) return null
    return { x: geo.mx[index], y: geo.my![index], w: geo.cellW, h: geo.mh![index] }
  }
  const ri = rowIndexOfItem(geo, index)
  if (ri < 0) return null
  const r = geo.rows[ri]
  if (geo.mode === 'list') return { x: 0, y: r.y, w: geo.cellW, h: r.h }
  const col = index - r.start
  return { x: geo.padX + col * (geo.cellW + geo.gap), y: r.y, w: geo.cellW, h: geo.cellH }
}

/** Neighbour for arrow-key navigation. */
export function neighbour(geo: Geometry, index: number, dir: 'left' | 'right' | 'up' | 'down', count: number): number {
  if (count === 0) return -1
  if (index < 0) return 0
  if (dir === 'left') return Math.max(0, index - 1)
  if (dir === 'right') return Math.min(count - 1, index + 1)
  if (geo.mode === 'list') return dir === 'up' ? Math.max(0, index - 1) : Math.min(count - 1, index + 1)
  if (geo.mode === 'masonry' && geo.mx && geo.my) {
    // Closest item vertically adjacent in the same column.
    const x = geo.mx[index]
    const col = geo.columns!.find((c) => c.length && geo.mx![c[0]] === x)
    if (!col) return index
    const k = col.indexOf(index)
    const next = dir === 'up' ? col[k - 1] : col[k + 1]
    return next ?? index
  }
  const ri = rowIndexOfItem(geo, index)
  if (ri < 0) return index
  const col = index - geo.rows[ri].start
  let rj = ri
  do {
    rj += dir === 'up' ? -1 : 1
  } while (rj >= 0 && rj < geo.rows.length && geo.rows[rj].header)
  if (rj < 0 || rj >= geo.rows.length) return index
  const target = geo.rows[rj]
  return Math.min(target.start + col, target.end - 1)
}

/** Items intersecting a rectangle (marquee selection). */
export function itemsInRect(geo: Geometry, rect: Rect): number[] {
  const out: number[] = []
  const hit = (r: Rect): boolean => r.x < rect.x + rect.w && r.x + r.w > rect.x && r.y < rect.y + rect.h && r.y + r.h > rect.y
  if (geo.mode === 'masonry') {
    for (const i of visibleMasonry(geo, rect.y, rect.y + rect.h)) {
      const r = itemRect(geo, i)
      if (r && hit(r)) out.push(i)
    }
    return out
  }
  for (const row of visibleRows(geo, rect.y, rect.y + rect.h)) {
    if (row.header) continue
    for (let i = row.start; i < row.end; i++) {
      const r = geo.mode === 'list' ? { x: 0, y: row.y, w: geo.cellW, h: row.h } : { x: geo.padX + (i - row.start) * (geo.cellW + geo.gap), y: row.y, w: geo.cellW, h: geo.cellH }
      if (hit(r)) out.push(i)
    }
  }
  return out
}

/** Year markers for the timeline scrubber. */
export function yearMarkers(geo: Geometry): { year: number; y: number }[] {
  const out: { year: number; y: number }[] = []
  for (const r of geo.rows) if (r.header?.year !== undefined) out.push({ year: r.header.year, y: r.y })
  return out
}
