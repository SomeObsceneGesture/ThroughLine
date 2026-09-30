import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Heart } from 'lucide-react'
import { FLAG_THUMB, FLAG_VIDEO, rotationFromFlags } from '@shared/types'
import { useGallery, selectedIds } from '../../store/gallery'
import { getItem, requestItems, useItemsVersion } from '../../lib/items'
import { startMediaDrag, endMediaDrag } from '../../lib/dnd'
import { call, thumbUrl } from '../../lib/api'
import { dateTime, resolution, bytes, typeLabel, duration } from '../../lib/format'
import { cx } from '../../lib/cx'
import * as actions from '../../lib/actions'

const TILE = 88
const GAP = 6

/** Big preview of the focused item above a horizontal strip of thumbnails. */
export function FilmstripView() {
  const layout = useGallery((s) => s.layout)
  const focus = useGallery((s) => s.focus)
  const selection = useGallery((s) => s.selection)
  const indexOf = useGallery((s) => s.indexOf)
  useItemsVersion((s) => s.v)
  const strip = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [width, setWidth] = useState(0)

  const index = focus !== null && indexOf.has(focus) ? indexOf.get(focus)! : 0
  const id = layout?.ids[index]

  useEffect(() => {
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (layout && focus === null && layout.total) useGallery.getState().selectOnly(layout.ids[0])
  }, [layout, focus])

  // Keep the focused tile centred.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const target = 16 + index * (TILE + GAP) - el.clientWidth / 2 + TILE / 2
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }, [index])

  const [start, end] = useMemo(() => {
    const s = Math.max(0, Math.floor((scrollLeft - 16) / (TILE + GAP)) - 8)
    const e = Math.min(layout?.total ?? 0, Math.ceil((scrollLeft + width) / (TILE + GAP)) + 8)
    return [s, e]
  }, [scrollLeft, width, layout])

  useEffect(() => {
    if (!layout) return
    const ids: number[] = []
    for (let i = start; i < end; i++) ids.push(layout.ids[i])
    if (id !== undefined) ids.push(id)
    requestItems(ids)
  }, [start, end, layout, id])

  if (!layout || id === undefined) return null
  const item = getItem(id)
  const flags = layout.flags[index]
  const rotation = item?.rotation ?? rotationFromFlags(flags)
  const isVideo = !!(flags & FLAG_VIDEO)

  const move = (d: number): void => {
    const n = Math.max(0, Math.min(layout.total - 1, index + d))
    useGallery.getState().selectOnly(layout.ids[n])
  }

  return (
    <div
      className="flex-1 min-w-0 flex flex-col outline-none"
      data-gallery-scroller
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'Home') move(-Infinity)
        else if (e.key === 'End') move(Infinity)
      }}
    >
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center p-6 cursor-zoom-in"
        onDoubleClick={() => actions.openViewerAt(id)}
        onContextMenu={(e) => {
          e.preventDefault()
          void actions.mediaContextMenu(e.clientX, e.clientY)
        }}
      >
        <StagePreview key={id} id={id} ext={item?.ext} rotation={rotation} thumbReady={item ? item.thumbState === 1 : !!(flags & FLAG_THUMB)} video={isVideo} thumbVersion={item?.thumbVersion ?? 0} />
        {isVideo && (
          <button className="absolute h-16 w-16 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white hover:bg-black/65" onClick={() => actions.openViewerAt(id)} aria-label="Play">
            <Play size={26} className="fill-white ml-1" />
          </button>
        )}
      </div>
      <div className="h-12 shrink-0 flex items-center justify-center gap-3 text-[12px] text-fg-2 tabular px-4">
        {item && (
          <>
            <span className="font-medium text-fg truncate max-w-[30%]">{item.filename}</span>
            <span>{dateTime(item.sortDate)}</span>
            <span className="text-fg-3">{typeLabel(item)}</span>
            {item.width && <span className="text-fg-3">{resolution(item.width, item.height, item.rotation)}</span>}
            <span className="text-fg-3">{bytes(item.size)}</span>
            {item.duration ? <span className="text-fg-3">{duration(item.duration)}</span> : null}
            <button aria-label={item.favorite ? 'Unfavorite' : 'Favorite'} onClick={() => void actions.toggleFavorite([item.id])} className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-hover">
              <Heart size={14} className={item.favorite ? 'fill-danger text-danger' : 'text-fg-3'} />
            </button>
            <span className="text-fg-3">{(index + 1).toLocaleString()} of {layout.total.toLocaleString()}</span>
          </>
        )}
      </div>
      <div
        ref={strip}
        className="h-[112px] shrink-0 overflow-x-auto overflow-y-hidden scroll border-t border-line relative"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        <div className="relative h-full" style={{ width: 32 + layout.total * (TILE + GAP) }}>
          {Array.from({ length: Math.max(0, end - start) }, (_, k) => {
            const i = start + k
            const tid = layout.ids[i]
            const it = getItem(tid)
            const f = layout.flags[i]
            const ready = it ? it.thumbState === 1 : !!(f & FLAG_THUMB)
            const rot = it?.rotation ?? rotationFromFlags(f)
            const active = i === index
            return (
              <div
                key={tid}
                data-media-id={tid}
                draggable
                onDragStart={(e) => {
                  if (!selection.has(tid)) useGallery.getState().selectOnly(tid)
                  startMediaDrag(e, selectedIds())
                }}
                onDragEnd={endMediaDrag}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) useGallery.getState().toggle(tid)
                  else if (e.shiftKey) useGallery.getState().selectRange(tid, false)
                  else useGallery.getState().selectOnly(tid)
                }}
                onDoubleClick={() => actions.openViewerAt(tid)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!selection.has(tid)) useGallery.getState().selectOnly(tid)
                  void actions.mediaContextMenu(e.clientX, e.clientY)
                }}
                className={cx(
                  'absolute top-3 rounded-md overflow-hidden bg-thumb transition-[box-shadow,opacity] duration-150',
                  active ? 'shadow-[0_0_0_3px_var(--accent)]' : selection.has(tid) ? 'shadow-[0_0_0_2px_var(--accent)] opacity-90' : 'opacity-75 hover:opacity-100'
                )}
                style={{ left: 16 + i * (TILE + GAP), width: TILE, height: TILE }}
              >
                <div data-frame className="h-full w-full">
                  {ready && <img src={thumbUrl(tid, it?.thumbVersion ?? 0)} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" style={{ transform: rot ? `rotate(${rot}deg)` : undefined }} />}
                </div>
                {f & FLAG_VIDEO ? <Play size={10} className="absolute bottom-1 right-1 fill-white text-white drop-shadow" /> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StagePreview({ id, ext, rotation, thumbReady, video, thumbVersion }: { id: number; ext?: string; rotation: number; thumbReady: boolean; video: boolean; thumbVersion: number }) {
  const [full, setFull] = useState<string | null>(null)
  const [thumbSize, setThumbSize] = useState<{ w: number; h: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (video || !ext) return
    let live = true
    const t = window.setTimeout(() => {
      void call('media.fullUrl', id).then((url) => {
        const img = new Image()
        img.src = url
        img.decode().then(() => live && setFull(url)).catch(() => undefined)
      })
    }, 120)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [id, ext, video])
  const swap = rotation % 180 !== 0
  const src = full ?? (thumbReady ? thumbUrl(id, thumbVersion) : null)
  if (!src) return <div className="h-2/3 aspect-[4/3] rounded-lg shimmer" />
  return (
    <div ref={box} className="absolute inset-6 flex items-center justify-center">
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => setThumbSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="rounded-md shadow-[0_8px_40px_rgba(0,0,0,.25)] object-contain"
        style={
          swap
            ? { maxWidth: box.current?.clientHeight ?? '100%', maxHeight: box.current?.clientWidth ?? '100%', transform: `rotate(${rotation}deg)` }
            : { maxWidth: '100%', maxHeight: '100%', transform: rotation ? `rotate(${rotation}deg)` : undefined }
        }
        data-size={thumbSize ? `${thumbSize.w}x${thumbSize.h}` : undefined}
      />
    </div>
  )
}
