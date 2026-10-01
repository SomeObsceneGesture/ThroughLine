import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  X, ChevronLeft, ChevronRight, Info, Heart, RotateCw, Images, Tag, Play, Pause, MoreHorizontal, Trash2, FolderOpen,
  Copy, Repeat, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Pencil, AlertTriangle, Star
} from 'lucide-react'
import type { ExternalFile, MediaItem } from '@shared/types'
import { needsPreview } from '@shared/formats'
import { useUI } from '../../store/ui'
import { useApp } from '../../store/app'
import { useGallery } from '../../store/gallery'
import { call, isMac, on, thumbUrl } from '../../lib/api'
import { fetchItems, invalidateItems } from '../../lib/items'
import { dateTime, bytes, resolution, typeLabel } from '../../lib/format'
import { cx } from '../../lib/cx'
import { IconButton, Spinner, Button } from '../ui/controls'
import { InfoPanel } from '../InfoPanel'
import { VideoPlayer } from './VideoPlayer'
import * as actions from '../../lib/actions'
import { targetIn } from '../../lib/dom'

type Zoom = { mode: 'fit' | 'fill' | 'actual' | 'custom'; scale: number; x: number; y: number }

const preloadCache = new Map<string, HTMLImageElement>()
function preload(url: string): void {
  if (preloadCache.has(url)) return
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  void img.decode().catch(() => undefined)
  preloadCache.set(url, img)
  while (preloadCache.size > 8) preloadCache.delete(preloadCache.keys().next().value!)
}

function fullUrlFor(item: MediaItem): string {
  return item.kind === 'photo' && needsPreview(item.ext) ? `loupe://preview/${item.id}` : `loupe://media/${item.id}`
}

interface Current {
  key: string
  kind: 'photo' | 'video'
  name: string
  thumb: string | null
  full: string
  width: number | null
  height: number | null
  rotation: number
  item?: MediaItem
  external?: ExternalFile
  ext: string
}

export function Viewer() {
  const open = useUI((s) => s.viewer.open)
  const session = useUI((s) => s.viewer.session)
  if (!open) return null
  return <ViewerInner key={session} />
}

function ViewerInner() {
  const viewer = useUI((s) => s.viewer)
  const prefs = useApp((s) => s.prefs)!
  const setIndex = useUI((s) => s.setViewerIndex)
  const closeNow = useUI((s) => s.closeViewer)
  const close = closeNow
  const [items, setItems] = useState<Map<number, MediaItem>>(new Map())
  const [chrome, setChrome] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [zoom, setZoom] = useState<Zoom>({ mode: prefs.viewer.defaultZoom, scale: 1, x: 0, y: 0 })
  // Keyed by URL so a render right after navigating never shows the previous
  // photo's full image (or error) against the new item.
  const [full, setFull] = useState<{ url: string; w: number; h: number } | null>(null)
  const [fullErr, setFullErr] = useState<{ url: string; kind: string } | null>(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [closing, setClosing] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const imgWrap = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const idle = useRef<number | null>(null)
  const firstOpen = useRef(true)
  const external = viewer.mode === 'external'
  const total = external ? viewer.external.length : viewer.ids.length
  const index = Math.max(0, Math.min(viewer.index, total - 1))
  const id = external ? undefined : viewer.ids[index]

  // Fetch details for the current item and its neighbours.
  const refresh = useCallback(() => {
    if (external) return
    const want = [index - 2, index - 1, index, index + 1, index + 2].filter((i) => i >= 0 && i < total).map((i) => viewer.ids[i])
    void fetchItems(want).then((list) => setItems((m) => {
      const n = new Map(m)
      for (const it of list) n.set(it.id, it)
      return n
    }))
  }, [external, index, total, viewer.ids])
  useEffect(refresh, [refresh])
  useEffect(() => {
    if (external) return
    return on('library:changed', (c) => {
      if (c.type === 'items' && id !== undefined && c.ids.includes(id)) {
        invalidateItems([id])
        void fetchItems([id]).then(([it]) => it && setItems((m) => new Map(m).set(it.id, it)))
      }
    })
  }, [external, id])

  const current: Current | null = useMemo(() => {
    if (external) {
      const f = viewer.external[index]
      if (!f) return null
      return { key: f.path, kind: f.kind, name: f.name, thumb: null, full: f.url, width: null, height: null, rotation: 0, external: f, ext: f.name.split('.').pop()?.toLowerCase() ?? '' }
    }
    if (id === undefined) return null
    const it = items.get(id)
    if (!it) return { key: String(id), kind: 'photo', name: '', thumb: thumbUrl(id), full: '', width: null, height: null, rotation: 0, ext: '' }
    return {
      key: String(id),
      kind: it.kind,
      name: it.filename,
      thumb: it.thumbState === 1 ? thumbUrl(it.id, it.thumbVersion) : null,
      full: fullUrlFor(it),
      width: it.width,
      height: it.height,
      rotation: it.rotation,
      item: it,
      ext: it.ext
    }
  }, [external, viewer.external, index, id, items])

  const shown = full && full.url === current?.full ? full : null
  const loadedFull = shown?.url ?? null
  const natural = useMemo(() => (shown ? { w: shown.w, h: shown.h } : null), [shown?.url, shown?.w, shown?.h]) // eslint-disable-line react-hooks/exhaustive-deps
  const fullError = fullErr && fullErr.url === current?.full ? fullErr.kind : null

  // Load the full-resolution image once the item changes. A preloaded
  // neighbour is shown on the very first frame, without a thumbnail step.
  useLayoutEffect(() => {
    setZoom({ mode: prefs.viewer.defaultZoom, scale: 1, x: 0, y: 0 })
    if (!current || current.kind !== 'photo' || !current.full) return
    const url = current.full
    let live = true
    const img = preloadCache.get(url) ?? new Image()
    if (!img.src) img.src = url
    const done = (): void => {
      if (live) setFull({ url, w: img.naturalWidth, h: img.naturalHeight })
    }
    if (img.complete && img.naturalWidth > 0) done()
    else
      img
        .decode()
        .then(done)
        .catch(() => {
          if (!live) return
          preloadCache.delete(url)
          setFullErr({ url, kind: current.item?.missing ? 'missing' : 'unreadable' })
        })
    return () => {
      live = false
    }
  }, [current?.full, current?.kind, prefs.viewer.defaultZoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preload neighbours.
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const d of [1, -1, 2]) {
        const i = index + d
        if (i < 0 || i >= total) continue
        if (external) {
          const f = viewer.external[i]
          if (f?.kind === 'photo') preload(f.url)
        } else {
          const it = items.get(viewer.ids[i])
          if (it?.kind === 'photo') preload(fullUrlFor(it))
        }
      }
    }, 150)
    return () => window.clearTimeout(t)
  }, [index, total, items, external, viewer.external, viewer.ids])

  // Mark as viewed.
  useEffect(() => {
    if (id === undefined) return
    const t = window.setTimeout(() => void call('media.markViewed', id), 800)
    return () => window.clearTimeout(t)
  }, [id])

  // Keep the gallery selection in sync so closing lands on this item.
  useEffect(() => {
    if (id === undefined || external) return
    const g = useGallery.getState()
    if (g.indexOf.has(id)) {
      useGallery.setState({ focus: id, anchor: id, selection: new Set([id]) })
      ;(window as unknown as { __loupeScrollTo?: (id: number) => void }).__loupeScrollTo?.(id)
    }
  }, [id, external])

  // Stage size
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStageSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [showInfo])

  // Geometry of the displayed image.
  const dims = useMemo(() => {
    let w = natural?.w ?? current?.width ?? 0
    let h = natural?.h ?? current?.height ?? 0
    if (!w || !h) {
      w = 1600
      h = 1066
    }
    const rot = current?.rotation ?? 0
    const swap = rot % 180 !== 0
    const dw = swap ? h : w
    const dh = swap ? w : h
    const pad = 24
    const cw = Math.max(50, stageSize.w - pad * 2)
    const ch = Math.max(50, stageSize.h - pad * 2)
    // Small images are shown at 100% rather than blown up; vectors always fill.
    const vector = current?.ext === 'svg'
    const contain = Math.min(cw / dw, ch / dh)
    const fitScale = contain < 1 || vector ? contain : 1
    const fill = Math.max(cw / dw, ch / dh)
    return { w, h, dw, dh, fit: fitScale, fill, swap, rot }
  }, [natural, current, stageSize])

  const scale = zoom.mode === 'fit' ? dims.fit : zoom.mode === 'fill' ? dims.fill : zoom.mode === 'actual' ? 1 : zoom.scale
  const zoomed = scale > dims.fit + 0.001

  const clampPan = useCallback(
    (x: number, y: number, s: number) => {
      const maxX = Math.max(0, (dims.dw * s - stageSize.w) / 2)
      const maxY = Math.max(0, (dims.dh * s - stageSize.h) / 2)
      return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
    },
    [dims, stageSize]
  )

  const zoomTo = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const s = Math.max(Math.min(dims.fit, 0.05), Math.min(16, next))
      if (s <= dims.fit + 0.001) {
        setZoom({ mode: 'fit', scale: s, x: 0, y: 0 })
        return
      }
      // Keep the point under the cursor stationary.
      const px = cx ?? 0
      const py = cy ?? 0
      const k = s / scale
      const x = px - (px - zoom.x) * k
      const y = py - (py - zoom.y) * k
      const p = clampPan(x, y, s)
      setZoom({ mode: 'custom', scale: s, ...p })
    },
    [dims.fit, scale, zoom.x, zoom.y, clampPan]
  )

  const go = useCallback(
    (d: number) => {
      const n = index + d
      if (n < 0 || n >= total) return
      setIndex(n)
    },
    [index, total, setIndex]
  )

  const doClose = useCallback(() => {
    const session = useUI.getState().viewer.session
    const close = (): void => {
      if (useUI.getState().viewer.session === session) closeNow()
    }
    if (document.fullscreenElement) void document.exitFullscreen()
    const target = id !== undefined ? (window as unknown as { __loupeCellRect?: (id: number) => DOMRect | null }).__loupeCellRect?.(id) : null
    const el = imgWrap.current
    if (target && el && !zoomed && current?.kind === 'photo') {
      const r = el.getBoundingClientRect()
      const sx = target.width / r.width
      const sy = target.height / r.height
      const s = Math.max(sx, sy)
      const dx = target.left + target.width / 2 - (r.left + r.width / 2)
      const dy = target.top + target.height / 2 - (r.top + r.height / 2)
      setClosing(true)
      el.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
      root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' })
      window.setTimeout(close, 200)
    } else {
      setClosing(true)
      root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' })
      window.setTimeout(close, 130)
    }
    document.querySelector<HTMLElement>('[data-gallery-scroller]')?.focus({ preventScroll: true })
  }, [closeNow, id, zoomed, current?.kind])

  // Open animation from the thumbnail.
  useLayoutEffect(() => {
    if (!firstOpen.current) return
    firstOpen.current = false
    const origin = viewer.origin
    const el = imgWrap.current
    root.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
    if (!origin || !el) return
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      if (!r.width) return
      const s = Math.max(origin.width / r.width, origin.height / r.height)
      const dx = origin.left + origin.width / 2 - (r.left + r.width / 2)
      const dy = origin.top + origin.height / 2 - (r.top + r.height / 2)
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
    })
  }, [viewer.origin])

  // Slideshow
  useEffect(() => {
    if (!viewer.slideshow || !current) return
    if (current.kind === 'video') return // advances on end
    const t = window.setTimeout(() => {
      if (index + 1 < total) setIndex(index + 1)
      else useUI.getState().setSlideshow(false)
    }, prefs.viewer.slideshowSeconds * 1000)
    return () => window.clearTimeout(t)
  }, [viewer.slideshow, index, total, current, prefs.viewer.slideshowSeconds, setIndex])

  // Auto-hide chrome
  const poke = useCallback(() => {
    setChrome(true)
    if (idle.current) window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => setChrome(false), viewer.slideshow ? 1200 : 2600)
  }, [viewer.slideshow])
  useEffect(() => {
    poke()
    return () => {
      if (idle.current) window.clearTimeout(idle.current)
    }
  }, [poke])

  // Keyboard
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (useUI.getState().dialogs.length || useUI.getState().menu) return
      if (targetIn(e.target, 'input, textarea')) return
      const k = e.key
      const ids = id !== undefined ? [id] : []
      let handled = true
      if (k === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else if (zoomed) setZoom({ mode: 'fit', scale: 1, x: 0, y: 0 })
        else doClose()
      } else if (k === 'ArrowRight' && !e.shiftKey) go(1)
      else if (k === 'ArrowLeft' && !e.shiftKey) go(-1)
      else if (k === 'Home') setIndex(0)
      else if (k === 'End') setIndex(total - 1)
      else if (k === ' ' && current?.kind === 'photo') useUI.getState().setSlideshow(!viewer.slideshow)
      else if ((k === 'f' || k === 'F') && !e.metaKey && !e.ctrlKey && ids.length) void actions.toggleFavorite(ids)
      else if ((k === '+' || k === '=') && current?.kind === 'photo') zoomTo(scale * 1.4)
      else if ((k === '-' || k === '_') && current?.kind === 'photo') zoomTo(scale / 1.4)
      else if (k === '0' && current?.kind === 'photo') setZoom({ mode: 'fit', scale: 1, x: 0, y: 0 })
      else if (k === '1' && current?.kind === 'photo') setZoom({ mode: 'actual', scale: 1, x: 0, y: 0 })
      else if ((k === 'r' || k === 'R') && ids.length && !e.metaKey && !e.ctrlKey) void actions.rotate(ids, e.shiftKey ? -90 : 90)
      else if ((k === 'i' || k === 'I') && !external) setShowInfo((s) => !s)
      else if ((k === 't' || k === 'T') && ids.length) actions.tagDialog(ids)
      else if ((k === 'a' || k === 'A') && ids.length && !e.metaKey && !e.ctrlKey) actions.albumPicker(ids)
      else if ((k === 'Delete' || k === 'Backspace') && ids.length) void trashCurrent()
      else if (k === 'Enter' && current?.kind === 'photo') {
        if (!document.fullscreenElement) void root.current?.requestFullscreen().catch(() => undefined)
        else void document.exitFullscreen()
      } else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
        poke()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const trashCurrent = async (): Promise<void> => {
    if (id === undefined) return
    await actions.trash([id])
    const ids = viewer.ids.filter((x) => x !== id)
    if (!ids.length) {
      close()
      return
    }
    useUI.setState({ viewer: { ...useUI.getState().viewer, ids, index: Math.min(index, ids.length - 1), origin: null } })
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (current?.kind !== 'photo') return
    const r = stage.current!.getBoundingClientRect()
    const cx = e.clientX - r.left - r.width / 2
    const cy = e.clientY - r.top - r.height / 2
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025))
    zoomTo(scale * factor, cx, cy)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!zoomed || e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const start = { x: zoom.x, y: zoom.y }
    const s = scale
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const p = clampPan(start.x + ev.clientX - sx, start.y + ev.clientY - sy, s)
      setZoom({ mode: 'custom', scale: s, ...p })
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (current?.kind !== 'photo') return
    if (zoomed) setZoom({ mode: 'fit', scale: 1, x: 0, y: 0 })
    else {
      const r = stage.current!.getBoundingClientRect()
      const target = Math.max(1, dims.fit * 2)
      zoomTo(target, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
    }
  }

  const moreMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (external) {
      const f = current?.external
      if (!f) return
      useUI.getState().showMenu(r.right - 220, r.bottom + 6, [
        { label: isMac ? 'Show in Finder' : 'Show in Folder', icon: FolderOpen, onSelect: () => void call('app.showItemInFolder', f.path) },
        { label: 'Copy Path', icon: Copy, onSelect: () => void call('app.copyText', f.path) },
        ...(f.kind === 'photo' ? [{ label: 'Convert…', icon: Repeat, onSelect: async () => {
          const items = await call('convert.expand', [f.path])
          useUI.setState({ converterItems: items })
          close()
          useApp.getState().navigate({ kind: 'converter' })
        } }] : [])
      ])
      return
    }
    if (id === undefined) return
    useUI.getState().showMenu(r.right - 240, r.bottom + 6, [
      { label: isMac ? 'Show in Finder' : 'Show in Folder', icon: FolderOpen, onSelect: () => void actions.showInFolder(id) },
      { label: 'Copy Path', icon: Copy, onSelect: () => void actions.copyPaths([id]) },
      { separator: true },
      { label: 'Rating', icon: Star, submenu: [0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? '★'.repeat(n) : 'No Rating', checked: current?.item?.rating === n, onSelect: () => void actions.setRating([id], n) })) },
      { label: 'Rotate Counterclockwise', icon: RotateCw, onSelect: () => void actions.rotate([id], -90) },
      ...(current?.kind === 'photo'
        ? [
            { label: 'Convert…', icon: Repeat, onSelect: () => { close(); void actions.openConverter([id]) } },
            { label: 'Create Collage', icon: LayoutGrid, onSelect: () => { close(); actions.openCollage([id]) } }
          ]
        : []),
      { label: 'Rename…', icon: Pencil, onSelect: () => void actions.rename(id) },
      { separator: true },
      { label: 'Move to Recently Deleted', icon: Trash2, danger: true, shortcut: 'Del', onSelect: () => void trashCurrent() }
    ])
  }

  const bg = prefs.viewer.background === 'black' ? '#000' : prefs.viewer.background === 'dark' ? '#161618' : 'var(--canvas)'
  const darkChrome = prefs.viewer.background !== 'theme'
  const item = current?.item
  const imgSrc = loadedFull ?? current?.thumb ?? null
  const showingThumbOnly = !loadedFull && !!current?.thumb
  const dispW = dims.dw * scale
  const dispH = dims.dh * scale
  const imgW = dims.swap ? dispH : dispW
  const imgH = dims.swap ? dispW : dispH

  return (
    <div
      ref={root}
      data-viewer-root
      data-theme={darkChrome ? 'dark' : undefined}
      className={cx('fixed inset-0 z-[100] flex no-drag select-none', !chrome && !showInfo && 'cursor-none')}
      style={{ background: bg }}
      onMouseMove={poke}
      role="dialog"
      aria-label="Viewer"
      aria-modal="true"
    >
      <div className="relative flex-1 min-w-0 flex flex-col">
        {/* top bar */}
        <div
          className={cx(
            'absolute top-0 inset-x-0 z-20 h-14 flex items-center gap-2 pl-3 pr-3 transition-opacity duration-200 drag-region',
            isMac ? 'pl-[84px]' : '',
            chrome || showInfo ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          style={{ background: darkChrome ? 'linear-gradient(to bottom, rgba(0,0,0,.55), transparent)' : 'linear-gradient(to bottom, var(--canvas), transparent)' }}
        >
          <IconButton icon={X} label="Close (Esc)" tone={darkChrome ? 'onDark' : 'default'} onClick={doClose} />
          <div className={cx('min-w-0 ml-1', darkChrome ? 'text-white' : 'text-fg')}>
            <div className="text-[13px] font-medium truncate">{current?.name}</div>
            <div className={cx('text-[11.5px] tabular truncate', darkChrome ? 'text-white/60' : 'text-fg-3')}>
              {item ? `${dateTime(item.sortDate)} · ${typeLabel(item)} · ${resolution(item.width, item.height, item.rotation)} · ${bytes(item.size)}` : current?.external ? bytes(current.external.size) : ''}
              {total > 1 && ` · ${(index + 1).toLocaleString()} of ${total.toLocaleString()}`}
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 titlebar-pad-right" style={{ paddingRight: isMac ? 0 : undefined }}>
            {current?.kind === 'photo' && (
              <>
                <IconButton icon={ZoomOut} label="Zoom out (−)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => zoomTo(scale / 1.4)} />
                <button
                  className={cx('h-8 min-w-[52px] px-2 rounded-md text-[12px] tabular font-medium', darkChrome ? 'text-white/85 hover:bg-white/12' : 'text-fg-2 hover:bg-hover')}
                  onClick={() => setZoom(zoomed ? { mode: 'fit', scale: 1, x: 0, y: 0 } : { mode: 'actual', scale: 1, x: 0, y: 0 })}
                  title={zoomed ? 'Fit to screen (0)' : 'Actual size (1)'}
                >
                  {Math.round(scale * 100)}%
                </button>
                <IconButton icon={ZoomIn} label="Zoom in (+)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => zoomTo(scale * 1.4)} />
                <IconButton icon={Maximize2} label="Fit to screen (0)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => setZoom({ mode: 'fit', scale: 1, x: 0, y: 0 })} />
                <div className={cx('w-px h-5 mx-1.5', darkChrome ? 'bg-white/15' : 'bg-line')} />
              </>
            )}
            {!external && id !== undefined && (
              <>
                <IconButton icon={Heart} label={item?.favorite ? 'Unfavorite (F)' : 'Favorite (F)'} tone={darkChrome ? 'onDark' : 'default'} active={item?.favorite} onClick={() => void actions.toggleFavorite([id])} className={item?.favorite ? '[&_svg]:fill-current' : ''} />
                <IconButton icon={RotateCw} label="Rotate (R)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => void actions.rotate([id], 90)} />
                <IconButton icon={Images} label="Add to album (A)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => actions.albumPicker([id])} />
                <IconButton icon={Tag} label="Tags (T)" tone={darkChrome ? 'onDark' : 'default'} onClick={() => actions.tagDialog([id])} />
              </>
            )}
            {external && current?.external && !current.external.mediaId && (
              <Button size="sm" variant="primary" className="mx-1" onClick={() => void actions.startImport([current.external!.path])}>
                Add to Library
              </Button>
            )}
            {total > 1 && (
              <IconButton icon={viewer.slideshow ? Pause : Play} label={viewer.slideshow ? 'Pause slideshow (Space)' : 'Slideshow (Space)'} tone={darkChrome ? 'onDark' : 'default'} active={viewer.slideshow} onClick={() => useUI.getState().setSlideshow(!viewer.slideshow)} />
            )}
            {!external && <IconButton icon={Info} label="Info (I)" tone={darkChrome ? 'onDark' : 'default'} active={showInfo} onClick={() => setShowInfo(!showInfo)} />}
            <IconButton icon={MoreHorizontal} label="More" tone={darkChrome ? 'onDark' : 'default'} onClick={moreMenu} />
          </div>
        </div>

        {/* stage */}
        <div
          ref={stage}
          className={cx('relative flex-1 min-h-0 overflow-hidden flex items-center justify-center', zoomed && 'cursor-grab active:cursor-grabbing')}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onClick={(e) => {
            if (e.target === e.currentTarget && !zoomed && current?.kind === 'photo') doClose()
          }}
        >
          {current?.kind === 'video' ? (
            <div className="absolute inset-0 flex items-center justify-center" key={current.key}>
              <VideoPlayer
                id={id}
                src={external ? current.full : undefined}
                active={!closing}
                autoplay={prefs.viewer.autoplayVideo}
                loop={prefs.viewer.loopVideo}
                poster={current.thumb ?? undefined}
                onEnded={() => {
                  if (viewer.slideshow && index + 1 < total) setIndex(index + 1)
                }}
              />
            </div>
          ) : fullError && !current?.thumb ? (
            <ErrorPanel kind={fullError} item={item} external={current?.external} />
          ) : imgSrc ? (
            <div
              ref={imgWrap}
              key={current?.key}
              className={cx('absolute', prefs.viewer.slideshowTransition === 'fade' && viewer.slideshow && 'anim-fade')}
              style={{
                width: imgW,
                height: imgH,
                left: `calc(50% - ${imgW / 2}px)`,
                top: `calc(50% - ${imgH / 2}px)`,
                transform: `translate(${zoom.x}px, ${zoom.y}px) rotate(${dims.rot}deg)`,
                transition: zoom.mode === 'custom' ? 'none' : 'transform 180ms var(--ease), width 180ms var(--ease), height 180ms var(--ease), left 180ms var(--ease), top 180ms var(--ease)'
              }}
            >
              <img
                src={imgSrc}
                alt={current?.name}
                data-item={id}
                data-loaded={loadedFull ? 'full' : 'thumb'}
                draggable={false}
                className="w-full h-full"
                style={{ imageRendering: scale >= 3 ? 'pixelated' : 'auto', filter: showingThumbOnly && natural === null && scale > 1.2 ? 'blur(0.5px)' : undefined }}
              />
            </div>
          ) : (
            <Spinner size={26} className={darkChrome ? 'text-white/70' : 'text-fg-3'} />
          )}
          {current?.kind === 'photo' && !loadedFull && !fullError && current.full && (
            <div className="absolute bottom-5 right-5 text-white/70"><Spinner size={16} /></div>
          )}
          {fullError && current?.thumb && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-black/70 text-white text-[12.5px] flex items-center gap-2">
              <AlertTriangle size={14} className="text-[#ffb347]" />
              {fullError === 'missing' ? 'The original isn’t available — showing the thumbnail.' : 'The full-size image couldn’t be loaded — showing the thumbnail.'}
              {item && <button className="underline ml-1" onClick={() => actions.explainItemError(item)}>Details</button>}
            </div>
          )}
        </div>

        {/* prev / next */}
        {index > 0 && (
          <button
            aria-label="Previous"
            onClick={() => go(-1)}
            className={cx('absolute left-3 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full flex items-center justify-center transition-opacity duration-200 bg-black/35 hover:bg-black/55 text-white backdrop-blur', chrome ? 'opacity-100' : 'opacity-0')}
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {index < total - 1 && (
          <button
            aria-label="Next"
            onClick={() => go(1)}
            className={cx('absolute right-3 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full flex items-center justify-center transition-opacity duration-200 bg-black/35 hover:bg-black/55 text-white backdrop-blur', chrome ? 'opacity-100' : 'opacity-0')}
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* filmstrip */}
        {prefs.viewer.showFilmstrip && !external && total > 1 && current?.kind !== 'video' && (
          <Filmstrip ids={viewer.ids} index={index} visible={chrome} onPick={setIndex} />
        )}
      </div>
      {showInfo && id !== undefined && <InfoPanel ids={[id]} onClose={() => setShowInfo(false)} />}
    </div>
  )
}

function Filmstrip({ ids, index, visible, onPick }: { ids: number[]; index: number; visible: boolean; onPick: (i: number) => void }) {
  const W = 52
  const G = 4
  const span = 12
  const start = Math.max(0, index - span)
  const end = Math.min(ids.length, index + span + 1)
  return (
    <div className={cx('absolute bottom-3 left-1/2 -translate-x-1/2 z-10 transition-opacity duration-200', visible ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
      <div className="flex gap-1 p-1.5 rounded-xl bg-black/45 backdrop-blur-xl border border-white/10" style={{ transform: `translateX(${((start + end - 1) / 2 - index) * (W + G)}px)` }}>
        {ids.slice(start, end).map((id, k) => {
          const i = start + k
          return (
            <button
              key={id}
              onClick={() => onPick(i)}
              aria-label={`Go to item ${i + 1}`}
              className={cx('h-[38px] rounded-md overflow-hidden transition-all duration-150 bg-white/10 shrink-0', i === index ? 'ring-2 ring-white opacity-100' : 'opacity-55 hover:opacity-90')}
              style={{ width: i === index ? W + 10 : W }}
            >
              <img src={thumbUrl(id)} alt="" className="h-full w-full object-cover" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ErrorPanel({ kind, item, external }: { kind: string; item?: MediaItem; external?: ExternalFile }) {
  const path = item?.path ?? external?.path
  return (
    <div className="flex flex-col items-center text-center gap-3 max-w-[420px] px-6 text-white/85">
      <AlertTriangle size={30} className="text-[#ffb347]" />
      <div className="text-[16px] font-semibold">{kind === 'missing' ? 'This file isn’t available' : 'This image could not be opened'}</div>
      <div className="text-[13px] text-white/60 leading-relaxed">
        {kind === 'missing'
          ? 'It may have been moved or deleted, or it’s on a drive that isn’t connected right now.'
          : item?.error ?? 'The file may be corrupted or use an unsupported format.'}
      </div>
      <div className="flex gap-2 mt-2">
        {path && <Button size="sm" className="bg-white/10! text-white! border-white/15!" onClick={() => void call('app.showItemInFolder', path)}>Show File</Button>}
        {item && <Button size="sm" variant="ghost" className="text-white/70! hover:bg-white/10!" onClick={() => actions.explainItemError(item)}>Details</Button>}
      </div>
      <div className="text-[11.5px] text-white/35 mt-1">Use ← / → to keep browsing</div>
    </div>
  )
}
