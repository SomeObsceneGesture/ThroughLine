import { useEffect, useMemo, useRef } from 'react'
import { Heart, Play, ArrowDown, ArrowUp, Star, WifiOff } from 'lucide-react'
import type { SortKey } from '@shared/types'
import { FLAG_THUMB, FLAG_VIDEO, rotationFromFlags } from '@shared/types'
import { useGallery, selectedIds, currentView, effectiveSort } from '../../store/gallery'
import { getItem, requestItems, useItemsVersion } from '../../lib/items'
import { startMediaDrag, endMediaDrag } from '../../lib/dnd'
import { call, thumbUrl } from '../../lib/api'
import { bytes, dateTime, duration, resolution, typeLabel } from '../../lib/format'
import { cx } from '../../lib/cx'
import { useViewport } from './Gallery'
import * as actions from '../../lib/actions'

const ROW = 44
const HEAD = 40

const COLS: { key: string; label: string; sort?: SortKey; width: string; align?: 'right' }[] = [
  { key: 'name', label: 'Name', sort: 'name', width: 'minmax(220px, 3fr)' },
  { key: 'date', label: 'Date', sort: 'date', width: 'minmax(150px, 1.3fr)' },
  { key: 'type', label: 'Type', sort: 'type', width: '90px' },
  { key: 'dims', label: 'Dimensions', width: '120px' },
  { key: 'size', label: 'Size', sort: 'size', width: '84px', align: 'right' },
  { key: 'duration', label: 'Length', width: '70px', align: 'right' },
  { key: 'rating', label: 'Rating', sort: 'rating', width: '86px' },
  { key: 'folder', label: 'Folder', width: 'minmax(120px, 1.2fr)' }
]

export function ListView() {
  const scroller = useRef<HTMLDivElement>(null)
  const vp = useViewport(scroller)
  const layout = useGallery((s) => s.layout)
  const selection = useGallery((s) => s.selection)
  const focus = useGallery((s) => s.focus)
  useItemsVersion((s) => s.v)
  useGallery((s) => s.sortOverrides)
  const view = currentView()
  const sort = view ? effectiveSort(view) : null
  const template = COLS.map((c) => c.width).join(' ')

  const [start, end] = useMemo(() => {
    const s = Math.max(0, Math.floor((vp.top - HEAD) / ROW) - 10)
    const e = Math.min(layout?.total ?? 0, Math.ceil((vp.top + vp.height) / ROW) + 10)
    return [s, e]
  }, [vp.top, vp.height, layout])

  useEffect(() => {
    if (!layout) return
    const ids: number[] = []
    for (let i = start; i < end; i++) ids.push(layout.ids[i])
    requestItems(ids)
  }, [start, end, layout])

  const g = useGallery.getState
  const idx = (e: React.MouseEvent | React.DragEvent): number => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    return el ? parseInt(el.dataset.index!, 10) : -1
  }

  const scrollTo = (i: number): void => {
    const el = scroller.current
    if (!el) return
    const y = HEAD + i * ROW
    if (y < el.scrollTop + HEAD) el.scrollTop = y - HEAD
    else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight
  }

  if (!layout) return null
  const rows = []
  for (let i = start; i < end; i++) {
    const id = layout.ids[i]
    const it = getItem(id)
    const f = layout.flags[i]
    const selected = selection.has(id)
    const rot = it?.rotation ?? rotationFromFlags(f)
    rows.push(
      <div
        key={id}
        data-index={i}
        data-media-id={id}
        role="row"
        aria-selected={selected}
        draggable
        className={cx(
          'absolute left-0 right-0 grid items-center gap-3 px-4 text-[12.5px] rounded-md mx-2',
          selected ? 'bg-accent text-accent-fg' : i % 2 ? 'hover:bg-hover' : 'bg-[color-mix(in_srgb,var(--fg)_2.2%,transparent)] hover:bg-hover',
          focus === id && !selected && 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'
        )}
        style={{ top: HEAD + i * ROW, height: ROW - 4, gridTemplateColumns: template }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div data-frame className="h-8 w-8 rounded-[5px] overflow-hidden bg-thumb shrink-0 relative">
            {(it ? it.thumbState === 1 : f & FLAG_THUMB) ? (
              <img src={thumbUrl(id, it?.thumbVersion ?? 0)} alt="" draggable={false} className="h-full w-full object-cover" style={{ transform: rot ? `rotate(${rot}deg)` : undefined }} />
            ) : null}
            {f & FLAG_VIDEO ? <Play size={10} className="absolute bottom-0.5 right-0.5 fill-white text-white drop-shadow" /> : null}
          </div>
          <span className="truncate font-medium">{it?.filename ?? ''}</span>
          {it?.favorite && <Heart size={12} className={cx('shrink-0', selected ? 'fill-current' : 'fill-danger text-danger')} />}
          {it?.missing && <WifiOff size={12} className="shrink-0 opacity-70" />}
        </div>
        <span className={cx('truncate tabular', !selected && 'text-fg-2')}>{it ? dateTime(it.sortDate) : ''}</span>
        <span className={cx('truncate', !selected && 'text-fg-2')}>{it ? typeLabel(it) : ''}</span>
        <span className={cx('truncate tabular', !selected && 'text-fg-2')}>{it?.width ? resolution(it.width, it.height, it.rotation) : ''}</span>
        <span className={cx('truncate tabular text-right', !selected && 'text-fg-2')}>{it ? bytes(it.size) : ''}</span>
        <span className={cx('truncate tabular text-right', !selected && 'text-fg-2')}>{it?.duration ? duration(it.duration) : ''}</span>
        <span className="flex gap-px">
          {Array.from({ length: 5 }, (_, k) => (
            <Star key={k} size={11} className={cx(k < (it?.rating ?? 0) ? (selected ? 'fill-current' : 'fill-warning text-warning') : selected ? 'opacity-30' : 'text-fg-3 opacity-40')} />
          ))}
        </span>
        <span className={cx('truncate', !selected && 'text-fg-3')}>{it?.folderName ?? ''}</span>
      </div>
    )
  }

  return (
    <div
      ref={scroller}
      data-gallery-scroller
      tabIndex={0}
      role="grid"
      aria-label="Photos and videos"
      className="flex-1 overflow-auto scroll outline-none relative"
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const i = idx(e)
        if (i < 0) {
          if (!(e.target as HTMLElement).closest('[data-header]')) g().clear()
          return
        }
        const id = layout.ids[i]
        if (e.shiftKey) g().selectRange(id, e.metaKey || e.ctrlKey)
        else if (e.metaKey || e.ctrlKey) g().toggle(id)
        else if (!g().selection.has(id)) g().selectOnly(id)
      }}
      onClick={(e) => {
        const i = idx(e)
        if (i >= 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) g().selectOnly(layout.ids[i])
      }}
      onDoubleClick={(e) => {
        const i = idx(e)
        if (i >= 0) actions.openViewerAt(layout.ids[i])
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const i = idx(e)
        if (i < 0) return
        if (!g().selection.has(layout.ids[i])) g().selectOnly(layout.ids[i])
        void actions.mediaContextMenu(e.clientX, e.clientY)
      }}
      onDragStart={(e) => {
        const i = idx(e)
        if (i < 0) return
        if (!g().selection.has(layout.ids[i])) g().selectOnly(layout.ids[i])
        startMediaDrag(e, selectedIds())
      }}
      onDragEnd={endMediaDrag}
      onKeyDown={(e) => {
        const s = g()
        const cur = s.focus !== null ? (s.indexOf.get(s.focus) ?? -1) : -1
        let next = -1
        if (e.key === 'ArrowDown') next = Math.min(layout.total - 1, cur + 1)
        else if (e.key === 'ArrowUp') next = Math.max(0, cur - 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = layout.total - 1
        else if (e.key === 'PageDown') next = Math.min(layout.total - 1, cur + Math.floor(vp.height / ROW))
        else if (e.key === 'PageUp') next = Math.max(0, cur - Math.floor(vp.height / ROW))
        else return
        e.preventDefault()
        const id = layout.ids[next]
        if (e.shiftKey) s.selectRange(id, false)
        else s.selectOnly(id)
        scrollTo(next)
      }}
    >
      <div className="relative" style={{ height: HEAD + layout.total * ROW + 16 }}>
        <div
          data-header
          role="row"
          className="sticky top-0 z-10 grid items-center gap-3 px-6 h-10 text-[11.5px] font-medium text-fg-3 bg-canvas/95 backdrop-blur border-b border-line"
          style={{ gridTemplateColumns: template }}
        >
          {COLS.map((c) => (
            <button
              key={c.key}
              role="columnheader"
              disabled={!c.sort}
              className={cx('flex items-center gap-1 truncate text-left hover:text-fg-2 disabled:hover:text-fg-3', c.align === 'right' && 'justify-end', sort?.sort === c.sort && 'text-fg')}
              onClick={() => c.sort && useGallery.getState().setSort(c.sort, sort?.sort === c.sort && sort?.dir === 'desc' ? 'asc' : 'desc')}
            >
              {c.label}
              {sort?.sort === c.sort && (sort?.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
            </button>
          ))}
        </div>
        {rows}
      </div>
    </div>
  )
}

export function prioritizeVisible(ids: number[]): void {
  if (ids.length) void call('media.prioritize', ids)
}
