import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LayoutMode } from '@shared/types'
import { FLAG_THUMB, FLAG_THUMB_FAILED } from '@shared/types'
import { useApp } from '../../store/app'
import { useGallery, currentView, selectedIds, viewKey, effectiveSort } from '../../store/gallery'
import { useUI } from '../../store/ui'
import { computeGeometry, itemRect, itemsInRect, neighbour, visibleMasonry, visibleRows, yearMarkers, type Geometry, type Rect } from '../../lib/layout'
import { getItem, requestItems, useItemsVersion } from '../../lib/items'
import { startMediaDrag, endMediaDrag, isMediaDrag, draggedIds } from '../../lib/dnd'
import { call } from '../../lib/api'
import { Cell } from './Cell'
import { ListView } from './ListView'
import { FilmstripView } from './FilmstripView'
import { EmptyState } from './EmptyState'
import { TimelineScrubber } from './TimelineScrubber'
import * as actions from '../../lib/actions'
import { cx } from '../../lib/cx'

const scrollMemory = new Map<string, number>()

export function useViewport(ref: React.RefObject<HTMLElement | null>): { top: number; height: number; width: number } {
  const [vp, setVp] = useState({ top: 0, height: 0, width: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const update = (): void => {
      frame = 0
      setVp((prev) => {
        const next = { top: el.scrollTop, height: el.clientHeight, width: el.clientWidth }
        return prev.top === next.top && prev.height === next.height && prev.width === next.width ? prev : next
      })
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref])
  return vp
}

export function Gallery() {
  const layout = useGallery((s) => s.layout)
  const loadedOnce = useGallery((s) => s.loadedOnce)
  const prefs = useApp((s) => s.prefs)!
  const route = useApp((s) => s.route)
  const view = route.kind === 'view' ? route.view : null
  const mode: LayoutMode = view?.type === 'timeline' ? 'timeline' : prefs.layout

  if (!view) return null
  if (loadedOnce && layout && layout.total === 0) return <EmptyState view={view} />
  if (mode === 'list') return <ListView />
  if (mode === 'filmstrip') return <FilmstripView />
  return <GridGallery mode={mode} />
}

function GridGallery({ mode }: { mode: LayoutMode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const vp = useViewport(scroller)
  const layout = useGallery((s) => s.layout)
  const queryKey = useGallery((s) => s.queryKey)
  const selection = useGallery((s) => s.selection)
  const focus = useGallery((s) => s.focus)
  const indexOf = useGallery((s) => s.indexOf)
  const prefs = useApp((s) => s.prefs)!
  const route = useApp((s) => s.route)
  useItemsVersion((s) => s.v)
  const dragActive = useUI((s) => s.dragActive)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [dropBefore, setDropBefore] = useState<number | null>(null)

  const view = route.kind === 'view' ? route.view : null
  const reorderable = view?.type === 'album' && effectiveSort(view).sort === 'manual' && mode === 'grid'

  const geo: Geometry | null = useMemo(() => {
    if (!layout || !vp.width) return null
    return computeGeometry({
      mode,
      width: vp.width,
      thumbSize: prefs.thumbSize,
      density: prefs.density,
      info: prefs.info,
      squareThumbs: prefs.squareThumbs,
      ratios: layout.ratios,
      dates: layout.dates,
      count: layout.total,
      groupByDate: mode === 'timeline'
    })
  }, [layout, vp.width, mode, prefs.thumbSize, prefs.density, prefs.info, prefs.squareThumbs])

  // Keep a stable anchor when the geometry changes (resize, zoom, layout switch).
  const anchorRef = useRef<{ index: number; offset: number } | null>(null)
  const prevGeo = useRef<Geometry | null>(null)
  const prevKey = useRef('')
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !geo || !layout) return
    const vk = view ? viewKey(view) : ''
    if (prevKey.current !== vk) {
      // New view: restore remembered scroll position.
      el.scrollTop = scrollMemory.get(vk) ?? 0
      prevKey.current = vk
    } else if (prevGeo.current && prevGeo.current !== geo && anchorRef.current) {
      const r = itemRect(geo, anchorRef.current.index)
      if (r && (prevGeo.current.mode !== geo.mode || prevGeo.current.cellW !== geo.cellW || prevGeo.current.totalHeight !== geo.totalHeight)) {
        el.scrollTop = Math.max(0, r.y - anchorRef.current.offset)
      }
    }
    prevGeo.current = geo
  }, [geo, layout, view])

  // Track the top-most visible item as the anchor and remember scroll positions.
  useEffect(() => {
    if (!geo || !layout) return
    const vk = view ? viewKey(view) : ''
    scrollMemory.set(vk, vp.top)
    let idx = -1
    if (geo.mode === 'masonry') {
      const vis = visibleMasonry(geo, vp.top, vp.top + 40)
      idx = vis.length ? Math.min(...vis) : -1
    } else {
      const rows = visibleRows(geo, vp.top, vp.top + 1)
      const r = rows.find((x) => !x.header) ?? rows[0]
      if (r) idx = r.start
    }
    if (focus !== null && indexOf.has(focus)) {
      const fr = itemRect(geo, indexOf.get(focus)!)
      if (fr && fr.y >= vp.top && fr.y < vp.top + vp.height) idx = indexOf.get(focus)!
    }
    if (idx >= 0) {
      const r = itemRect(geo, idx)
      if (r) anchorRef.current = { index: idx, offset: r.y - vp.top }
    }
  }, [vp.top, vp.height, geo, layout, focus, indexOf, view])

  // Visible cells
  const overscan = Math.max(400, vp.height)
  const visible: number[] = useMemo(() => {
    if (!geo || !layout) return []
    const top = vp.top - overscan
    const bottom = vp.top + vp.height + overscan
    if (geo.mode === 'masonry') return visibleMasonry(geo, top, bottom)
    const out: number[] = []
    for (const r of visibleRows(geo, top, bottom)) {
      if (r.header) continue
      for (let i = r.start; i < r.end; i++) out.push(i)
    }
    return out
  }, [geo, layout, vp.top, vp.height, overscan])

  const headers = useMemo(() => {
    if (!geo || geo.mode === 'masonry') return []
    return visibleRows(geo, vp.top - overscan, vp.top + vp.height + overscan).filter((r) => r.header)
  }, [geo, vp.top, vp.height, overscan])

  // Fetch details for visible items; nudge the indexer to do these first.
  useEffect(() => {
    if (!layout) return
    const ids = visible.map((i) => layout.ids[i])
    requestItems(ids)
    const t = window.setTimeout(() => {
      const pending = visible.filter((i) => !(layout.flags[i] & (FLAG_THUMB | FLAG_THUMB_FAILED))).map((i) => layout.ids[i])
      if (pending.length) void call('media.prioritize', pending.slice(0, 300))
    }, 200)
    return () => window.clearTimeout(t)
  }, [visible, layout])

  const scrollIntoView = useCallback(
    (index: number) => {
      const el = scroller.current
      if (!el || !geo) return
      const r = itemRect(geo, index)
      if (!r) return
      if (r.y < el.scrollTop + 8) el.scrollTop = r.y - 16
      else if (r.y + r.h > el.scrollTop + el.clientHeight - 8) el.scrollTop = r.y + r.h - el.clientHeight + 16
    },
    [geo]
  )

  // Register a lookup so the viewer can animate from/to the thumbnail.
  useEffect(() => {
    ;(window as unknown as { __loupeCellRect?: (id: number) => DOMRect | null }).__loupeCellRect = (id: number) => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-media-id="${id}"] [data-frame]`)
      return el?.getBoundingClientRect() ?? null
    }
    ;(window as unknown as { __loupeScrollTo?: (id: number) => void }).__loupeScrollTo = (id: number) => {
      const i = useGallery.getState().indexOf.get(id)
      if (i !== undefined) scrollIntoView(i)
    }
  }, [scrollIntoView])

  // ── pointer interaction ──
  const cellFrom = (e: React.MouseEvent | React.DragEvent): { index: number; id: number } | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (!el || !layout) return null
    const index = parseInt(el.dataset.index!, 10)
    return { index, id: layout.ids[index] }
  }

  const g = useGallery.getState
  const clickedOnSelected = useRef(false)

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const c = cellFrom(e)
    scroller.current?.focus({ preventScroll: true })
    if (c) {
      const target = e.target as HTMLElement
      if (target.closest('[data-fav-toggle]')) return
      if (target.closest('[data-select-toggle]')) {
        g().toggle(c.id)
        return
      }
      clickedOnSelected.current = g().selection.has(c.id)
      if (e.shiftKey) g().selectRange(c.id, e.metaKey || e.ctrlKey)
      else if (e.metaKey || e.ctrlKey) g().toggle(c.id)
      else if (!g().selection.has(c.id)) g().selectOnly(c.id)
      else g().setFocus(c.id)
      return
    }
    // Empty space: start marquee selection.
    const el = scroller.current!
    const box = el.getBoundingClientRect()
    const startX = e.clientX - box.left
    const startY = e.clientY - box.top + el.scrollTop
    const additive = e.metaKey || e.ctrlKey || e.shiftKey
    const base = additive ? new Set(g().selection) : new Set<number>()
    let moved = false
    let lastClientY = e.clientY
    let raf = 0
    const update = (clientX: number, clientY: number): void => {
      const x = clientX - box.left
      const y = clientY - box.top + el.scrollTop
      const rect = { x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) }
      if (!moved && rect.w < 4 && rect.h < 4) return
      moved = true
      setMarquee(rect)
      if (geo && layout) {
        const hits = itemsInRect(geo, rect)
        const s = new Set(base)
        for (const i of hits) s.add(layout.ids[i])
        g().setSelection(s)
      }
    }
    const autoScroll = (): void => {
      const edge = 40
      if (lastClientY < box.top + edge) el.scrollTop -= Math.ceil((box.top + edge - lastClientY) / 3)
      else if (lastClientY > box.bottom - edge) el.scrollTop += Math.ceil((lastClientY - box.bottom + edge) / 3)
      raf = requestAnimationFrame(autoScroll)
    }
    let lastX = e.clientX
    const move = (ev: MouseEvent): void => {
      lastClientY = ev.clientY
      lastX = ev.clientX
      update(ev.clientX, ev.clientY)
      if (moved && !raf) raf = requestAnimationFrame(autoScroll)
    }
    const onScroll = (): void => update(lastX, lastClientY)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
      setMarquee(null)
      if (!moved && !additive) g().clear()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    el.addEventListener('scroll', onScroll)
  }

  const onClick = (e: React.MouseEvent): void => {
    const c = cellFrom(e)
    if (!c) return
    const target = e.target as HTMLElement
    if (target.closest('[data-fav-toggle]')) {
      e.stopPropagation()
      void actions.toggleFavorite([c.id])
      return
    }
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && clickedOnSelected.current && !target.closest('[data-select-toggle]')) g().selectOnly(c.id)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    const c = cellFrom(e)
    if (!c || (e.target as HTMLElement).closest('[data-fav-toggle],[data-select-toggle]')) return
    const frame = (e.target as HTMLElement).closest('[data-index]')?.querySelector('[data-frame]')
    actions.openViewerAt(c.id, frame?.getBoundingClientRect() ?? null)
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const c = cellFrom(e)
    if (!c) return
    if (!g().selection.has(c.id)) g().selectOnly(c.id)
    void actions.mediaContextMenu(e.clientX, e.clientY)
  }

  const onDragStart = (e: React.DragEvent): void => {
    const c = cellFrom(e)
    if (!c) {
      e.preventDefault()
      return
    }
    if (!g().selection.has(c.id)) g().selectOnly(c.id)
    const ids = selectedIds()
    const versions = new Map<number, number>()
    for (const id of ids.slice(0, 3)) versions.set(id, getItem(id)?.thumbVersion ?? 0)
    startMediaDrag(e, ids, versions)
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (!reorderable || !isMediaDrag(e) || !geo || !layout) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const box = scroller.current!.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top + scroller.current!.scrollTop
    const rows = visibleRows(geo, y, y)
    const row = rows.find((r) => !r.header)
    if (!row) return
    const col = Math.round((x - geo.padX) / (geo.cellW + geo.gap))
    const index = Math.min(row.end, row.start + Math.max(0, col))
    setDropBefore(index)
  }

  const onDrop = (e: React.DragEvent): void => {
    if (!reorderable || !isMediaDrag(e) || !layout || view?.type !== 'album') return
    e.preventDefault()
    const ids = draggedIds()
    const before = dropBefore !== null && dropBefore < layout.ids.length ? layout.ids[dropBefore] : null
    setDropBefore(null)
    endMediaDrag()
    if (ids.length && !(before !== null && ids.includes(before))) void call('albums.reorder', view.id, ids, before)
  }

  // ── keyboard ──
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!geo || !layout || !layout.total) return
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
    const dir = dirs[e.key]
    const s = g()
    const cur = s.focus !== null ? (s.indexOf.get(s.focus) ?? -1) : -1
    let next = -1
    if (dir) next = neighbour(geo, cur, dir, layout.total)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = layout.total - 1
    else if (e.key === 'PageDown' || e.key === 'PageUp') {
      const r = cur >= 0 ? itemRect(geo, cur) : null
      const y = (r?.y ?? vp.top) + (e.key === 'PageDown' ? vp.height : -vp.height)
      const rows = visibleRows(geo, y, y).filter((x) => !x.header)
      next = rows[0] ? Math.min(rows[0].end - 1, rows[0].start + (cur >= 0 && r ? Math.round((r.x - geo.padX) / (geo.cellW + geo.gap)) : 0)) : cur
    } else return
    e.preventDefault()
    if (next < 0) return
    const id = layout.ids[next]
    if (e.shiftKey) {
      if (s.anchor === null) useGallery.setState({ anchor: s.focus ?? id })
      s.selectRange(id, false)
    } else s.selectOnly(id)
    scrollIntoView(next)
  }

  const radius = prefs.density === 'compact' ? 2 : prefs.density === 'comfortable' ? 6 : 8
  const selecting = selection.size > 0
  const sel = selection
  const focusId = focus

  return (
    <div className="relative flex-1 min-w-0 flex">
      <div
        ref={scroller}
        data-gallery-scroller
        tabIndex={0}
        role="grid"
        aria-label="Photos and videos"
        aria-multiselectable
        className="flex-1 overflow-y-auto overflow-x-hidden scroll outline-none relative"
        onMouseDown={onMouseDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragEnd={() => {
          endMediaDrag()
          setDropBefore(null)
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDropBefore(null)}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        {geo && layout && (
          <div className="relative" style={{ height: geo.totalHeight }} key={queryKey}>
            {headers.map((r) => (
              <div
                key={`h${r.y}`}
                className="absolute left-0 right-0 flex items-end"
                style={{ transform: `translateY(${r.y}px)`, height: r.h, paddingLeft: geo.padX, paddingRight: geo.padX, paddingBottom: 10 }}
              >
                <div className="flex items-baseline gap-3 w-full">
                  {r.header!.year !== undefined && <span className="text-[26px] font-bold tracking-[-0.03em] text-fg mr-1">{r.header!.year}</span>}
                  <span className={cx('font-semibold tracking-[-0.01em]', r.header!.year !== undefined ? 'text-[15px] text-fg-2' : 'text-[15px] text-fg')}>
                    {r.header!.title.replace(/\s\d{4}$/, '')}
                  </span>
                  <span className="text-[12px] text-fg-3 tabular">{r.header!.count.toLocaleString()}</span>
                  <button
                    className="ml-auto text-[12px] text-fg-3 hover:text-accent"
                    onClick={() => g().setSelection(Array.from(layout.ids.slice(r.header!.first, r.header!.first + r.header!.count)))}
                  >
                    Select
                  </button>
                </div>
              </div>
            ))}
            {visible.map((i) => {
              const id = layout.ids[i]
              const rect = itemRect(geo, i)
              if (!rect) return null
              return (
                <Cell
                  key={id}
                  id={id}
                  index={i}
                  x={rect.x}
                  y={rect.y}
                  w={rect.w}
                  h={rect.h}
                  imageH={geo.mode === 'masonry' ? rect.h - geo.captionH : geo.imageH}
                  item={getItem(id)}
                  flags={layout.flags[i]}
                  selected={sel.has(id)}
                  focused={focusId === id}
                  selecting={selecting}
                  contain={geo.contain}
                  info={prefs.info}
                  radius={radius}
                  dropBefore={dropBefore === i}
                />
              )
            })}
            {marquee && (
              <div
                className="absolute border border-accent bg-accent/15 rounded-[3px] pointer-events-none z-10"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
          </div>
        )}
      </div>
      {geo && mode === 'timeline' && <TimelineScrubber markers={yearMarkers(geo)} scroller={scroller} total={geo.totalHeight} />}
      {dragActive === 'media' && reorderable && <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent/40 rounded-lg" />}
    </div>
  )
}

export function useCurrentView() {
  return currentView()
}
