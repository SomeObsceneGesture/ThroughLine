import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus, Type, Trash2, Download, Wand2, Image as ImageIcon, GripVertical, RotateCcw, X, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, LayoutGrid } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { useUI, toast } from '../../store/ui'
import { call, thumbUrl, isMac } from '../../lib/api'
import { fetchItems } from '../../lib/items'
import { Button, IconButton, Segmented, Select, Slider, Switch, Spinner, Tooltip } from '../../components/ui/controls'
import { MediaPicker } from '../../components/dialogs/MediaPicker'
import { cx } from '../../lib/cx'
import {
  ASPECTS, FONTS, SWATCHES, TEMPLATES, applyTemplate, aspectRatio, coverPlacement, initialState, layoutTree, leaves, resizeAt, uid,
  type CollageState, type Rect, type TextLayer
} from './model'
import { canvasToBytes, exportSize, renderCollage, sourceUrl } from './render'

const TRAY_MIME = 'application/x-loupe-collage-media'
const CELL_MIME = 'application/x-loupe-collage-cell'

type Selection = { type: 'cell' | 'free' | 'text'; id: string } | null

function TemplateIcon({ id }: { id: string }) {
  const t = TEMPLATES.find((x) => x.id === id)!
  if (id === 'free') {
    return (
      <svg viewBox="0 0 40 40" className="w-full h-full">
        <rect x="4" y="6" width="18" height="14" rx="2" className="fill-current opacity-60" transform="rotate(-6 13 13)" />
        <rect x="17" y="16" width="19" height="15" rx="2" className="fill-current opacity-90" transform="rotate(5 26 23)" />
      </svg>
    )
  }
  const tree = t.build()!
  const { cells } = layoutTree(tree, { x: 3, y: 3, w: 34, h: 34 }, 2.5)
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      {[...cells.values()].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" className="fill-current opacity-75" />
      ))}
    </svg>
  )
}

export function CollageStudio() {
  const seed = useUI((s) => s.collageIds)
  const [state, setStateRaw] = useState<CollageState>(() => initialState(seed))
  const [tray, setTray] = useState<number[]>(seed)
  const [items, setItems] = useState<Map<number, MediaItem>>(new Map())
  const [sel, setSel] = useState<Selection>(null)
  const [editingText, setEditingText] = useState<string | null>(null)
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg')
  const [longEdge, setLongEdge] = useState(3000)
  const [quality, setQuality] = useState(92)
  const [addToLibrary, setAddToLibrary] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dropCell, setDropCell] = useState<string | null>(null)
  const undoStack = useRef<CollageState[]>([])
  const redoStack = useRef<CollageState[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 800, h: 600 })

  // New seeds (e.g. "Create Collage" from a selection) restart the studio.
  const seedKey = seed.join(',')
  const lastSeed = useRef(seedKey)
  useEffect(() => {
    if (lastSeed.current === seedKey || !seed.length) return
    lastSeed.current = seedKey
    setStateRaw(initialState(seed))
    setTray(seed)
    undoStack.current = []
    redoStack.current = []
  }, [seedKey, seed])

  const setState = useCallback((fn: (s: CollageState) => CollageState, record = true) => {
    setStateRaw((s) => {
      const next = fn(s)
      if (record && next !== s) {
        undoStack.current.push(s)
        if (undoStack.current.length > 80) undoStack.current.shift()
        redoStack.current = []
      }
      return next
    })
  }, [])
  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    setStateRaw((s) => {
      redoStack.current.push(s)
      return prev
    })
  }, [])
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    setStateRaw((s) => {
      undoStack.current.push(s)
      return next
    })
  }, [])

  // Item details for tray, cells and background.
  const neededIds = useMemo(() => {
    const s = new Set<number>(tray)
    for (const c of Object.values(state.cells)) if (c.mediaId !== null) s.add(c.mediaId)
    for (const f of state.free) s.add(f.mediaId)
    if (state.background.mediaId !== null) s.add(state.background.mediaId)
    return [...s]
  }, [tray, state])
  useEffect(() => {
    const missing = neededIds.filter((id) => !items.has(id))
    if (!missing.length) return
    void fetchItems(missing).then((list) => setItems((m) => {
      const n = new Map(m)
      for (const it of list) n.set(it.id, it)
      return n
    }))
  }, [neededIds, items])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Keyboard: undo/redo and delete within the studio.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return
      if (useUI.getState().dialogs.length) return
      const modKey = isMac ? e.metaKey : e.ctrlKey
      if (modKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) redo()
        else undo()
      } else if (modKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        e.stopPropagation()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        if (sel.type === 'text') setState((s) => ({ ...s, texts: s.texts.filter((t) => t.id !== sel.id) }))
        else if (sel.type === 'free') setState((s) => ({ ...s, free: s.free.filter((f) => f.id !== sel.id) }))
        else if (sel.type === 'cell') setState((s) => ({ ...s, cells: { ...s.cells, [sel.id]: { mediaId: null, zoom: 1, panX: 0, panY: 0 } } }))
        setSel(null)
      } else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', key, true)
    const onUndo = (): void => undo()
    const onRedo = (): void => redo()
    window.addEventListener('loupe:collage-undo', onUndo)
    window.addEventListener('loupe:collage-redo', onRedo)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('loupe:collage-undo', onUndo)
      window.removeEventListener('loupe:collage-redo', onRedo)
    }
  }, [sel, undo, redo, setState])

  // Preview geometry
  const ratio = aspectRatio(state.aspect)
  const pad = 48
  const availW = Math.max(100, stage.w - pad * 2)
  const availH = Math.max(100, stage.h - pad * 2)
  const W = Math.round(availW / availH > ratio ? availH * ratio : availW)
  const H = Math.round(W / ratio)
  const unit = Math.min(W, H)
  const isFree = state.template === 'free'
  const layout = useMemo(() => {
    if (isFree) return { cells: new Map<string, Rect>(), gutters: [] }
    const m = state.margin * unit
    return layoutTree(state.tree, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, state.spacing * unit)
  }, [isFree, state.tree, state.margin, state.spacing, unit, W, H])

  const imgRatio = (id: number | null): number => {
    const m = id !== null ? items.get(id) : undefined
    if (!m?.width || !m.height) return 1.5
    return m.rotation % 180 ? m.height / m.width : m.width / m.height
  }

  const usedMedia = new Set<number>([...Object.values(state.cells).map((c) => c.mediaId).filter((x): x is number => x !== null), ...state.free.map((f) => f.mediaId)])

  const autoFill = (): void => {
    setState((s) => {
      if (s.template === 'free') return applyTemplate({ ...s, free: tray.map((m, i) => ({ id: uid('f'), mediaId: m, x: 0, y: 0, w: 0.3, h: 0.3, z: i })) }, 'free')
      const unused = tray.filter((m) => !Object.values(s.cells).some((c) => c.mediaId === m))
      const cells = { ...s.cells }
      for (const id of leaves(s.tree)) {
        if (cells[id]?.mediaId === null || cells[id] === undefined) {
          const m = unused.shift()
          if (m === undefined) break
          cells[id] = { mediaId: m, zoom: 1, panX: 0, panY: 0 }
        }
      }
      return { ...s, cells }
    })
  }

  const shuffle = (): void => {
    setState((s) => {
      if (s.template === 'free') return s
      const ids = leaves(s.tree)
      const media = ids.map((id) => s.cells[id]?.mediaId ?? null)
      for (let i = media.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[media[i], media[j]] = [media[j], media[i]]
      }
      const cells: CollageState['cells'] = {}
      ids.forEach((id, i) => (cells[id] = { mediaId: media[i], zoom: 1, panX: 0, panY: 0 }))
      return { ...s, cells }
    })
  }

  const addPhotos = (): void => {
    useUI.getState().openDialog((close) => (
      <MediaPicker
        title="Add photos to the collage"
        onClose={close}
        onPick={(ids) => {
          close()
          setTray((t) => [...t, ...ids.filter((id) => !t.includes(id))])
        }}
      />
    ))
  }

  const pickBackground = (): void => {
    useUI.getState().openDialog((close) => (
      <MediaPicker
        title="Choose a background photo"
        multiple={false}
        onClose={close}
        onPick={([id]) => {
          close()
          setState((s) => ({ ...s, background: { ...s.background, mediaId: id } }))
        }}
      />
    ))
  }

  const doExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const canvas = await renderCollage(state, items, longEdge)
      const bytes = await canvasToBytes(canvas, format, quality)
      const d = new Date()
      const name = `Collage ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const r = await call('collage.save', bytes, format, name, addToLibrary)
      if (r) toast('Collage exported', { kind: 'success', detail: r.path, action: { label: isMac ? 'Show in Finder' : 'Show', run: () => void call('app.showItemInFolder', r.path) } })
    } catch (err) {
      toast('The collage couldn’t be exported', { kind: 'error', detail: (err as Error).message })
    } finally {
      setExporting(false)
    }
  }

  // ── pointer helpers ──
  const dragPointer = (e: React.PointerEvent, onMove: (dx: number, dy: number) => void, onEnd?: () => void): void => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    let first = true
    const move = (ev: PointerEvent): void => {
      if (first) {
        first = false
        // Snapshot once per gesture for undo.
        setState((s) => ({ ...s }))
      }
      onMove(ev.clientX - sx, ev.clientY - sy)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const selectedText = sel?.type === 'text' ? state.texts.find((t) => t.id === sel.id) : undefined
  const selectedCell = sel?.type === 'cell' ? state.cells[sel.id] : undefined
  const updateText = (id: string, patch: Partial<TextLayer>, record = true): void =>
    setState((s) => ({ ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), record)

  const exportDims = exportSize(state.aspect, longEdge)
  const bgImage = state.background.mediaId !== null ? items.get(state.background.mediaId) : undefined

  return (
    <div className="flex-1 flex min-h-0">
      {/* Tray */}
      <aside className="w-[180px] shrink-0 border-r border-line flex flex-col min-h-0" aria-label="Photos">
        <div className="h-11 shrink-0 flex items-center px-3 gap-1">
          <span className="text-[12px] font-semibold text-fg-2 flex-1">Photos</span>
          <IconButton icon={Wand2} label="Fill empty spots" size={14} onClick={autoFill} disabled={!tray.length} />
          <IconButton icon={Plus} label="Add photos" size={15} onClick={addPhotos} />
        </div>
        <div className="flex-1 overflow-y-auto scroll px-3 pb-3">
          {tray.length === 0 ? (
            <button onClick={addPhotos} className="w-full aspect-square rounded-xl border-2 border-dashed border-line-strong flex flex-col items-center justify-center gap-2 text-fg-3 hover:text-fg-2 hover:border-fg-3 text-[12px]">
              <ImageIcon size={20} />
              Add photos
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {tray.map((id) => {
                const m = items.get(id)
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TRAY_MIME, String(id))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className="group relative aspect-square rounded-md overflow-hidden bg-thumb cursor-grab active:cursor-grabbing"
                    title="Drag onto the collage"
                  >
                    <img src={thumbUrl(id, m?.thumbVersion ?? 0)} alt="" draggable={false} className="h-full w-full object-cover" style={{ transform: m?.rotation ? `rotate(${m.rotation}deg)` : undefined }} />
                    {usedMedia.has(id) && <div className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-accent text-white flex items-center justify-center text-[9px] font-bold">✓</div>}
                    <button aria-label="Remove from tray" onClick={() => setTray((t) => t.filter((x) => x !== id))} className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/55 text-white items-center justify-center hidden group-hover:flex">
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-fg-3 mt-3 leading-relaxed">Drag photos onto the collage. Drag inside a photo to reposition it, scroll to zoom.</p>
        </div>
      </aside>

      {/* Stage */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-11 shrink-0 flex items-center gap-1 px-3 border-b border-line">
          <IconButton icon={Undo2} label={`Undo (${isMac ? '⌘' : 'Ctrl'}Z)`} onClick={undo} disabled={!undoStack.current.length} />
          <IconButton icon={Redo2} label="Redo" onClick={redo} disabled={!redoStack.current.length} />
          <div className="w-px h-5 bg-line mx-1" />
          <Button size="sm" variant="ghost" icon={Type} onClick={() => {
            const t: TextLayer = { id: uid('t'), text: 'Your text', x: 0.5, y: 0.5, size: 0.07, color: state.background.color === '#ffffff' || state.background.color === '#f5f1ea' ? '#111111' : '#ffffff', font: 'sans', weight: 600, align: 'center', shadow: false }
            setState((s) => ({ ...s, texts: [...s.texts, t] }))
            setSel({ type: 'text', id: t.id })
          }}>Add Text</Button>
          {!isFree && <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={shuffle}>Shuffle</Button>}
          <div className="flex-1" />
          <span className="text-[11.5px] text-fg-3 tabular">{exportDims.w} × {exportDims.h} px</span>
        </div>
        <div ref={stageRef} className="flex-1 min-h-0 relative flex items-center justify-center checker" onPointerDown={() => setSel(null)}>
          <div
            className="relative shadow-[0_18px_60px_rgba(0,0,0,.28)] overflow-hidden"
            style={{ width: W, height: H, background: state.background.color }}
            onDragOver={(e) => {
              if (isFree && e.dataTransfer.types.includes(TRAY_MIME)) e.preventDefault()
            }}
            onDrop={(e) => {
              if (!isFree) return
              const id = parseInt(e.dataTransfer.getData(TRAY_MIME), 10)
              if (!Number.isFinite(id)) return
              e.preventDefault()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const ir = imgRatio(id)
              const w = 0.38
              const h = (w * W) / ir / H
              setState((s) => ({ ...s, free: [...s.free, { id: uid('f'), mediaId: id, x: (e.clientX - r.left) / W - w / 2, y: (e.clientY - r.top) / H - h / 2, w, h, z: s.free.length }] }))
            }}
          >
            {bgImage && (
              <img
                src={sourceUrl(bgImage)}
                alt=""
                className="absolute object-cover pointer-events-none"
                style={{
                  inset: -(state.background.blur / 400) * unit,
                  width: `calc(100% + ${(state.background.blur / 200) * unit}px)`,
                  height: `calc(100% + ${(state.background.blur / 200) * unit}px)`,
                  filter: state.background.blur ? `blur(${(state.background.blur / 1000) * unit}px)` : undefined
                }}
              />
            )}
            {!isFree &&
              [...layout.cells.entries()].map(([cid, r]) => {
                const c = state.cells[cid] ?? { mediaId: null, zoom: 1, panX: 0, panY: 0 }
                const m = c.mediaId !== null ? items.get(c.mediaId) : undefined
                const ir = imgRatio(c.mediaId)
                const p = coverPlacement({ x: 0, y: 0, w: r.w, h: r.h }, ir, c.zoom, c.panX, c.panY)
                const rot = m?.rotation ?? 0
                const swap = rot % 180 !== 0
                const selected = sel?.type === 'cell' && sel.id === cid
                return (
                  <div
                    key={cid}
                    className={cx('absolute group overflow-hidden', selected && 'z-10')}
                    style={{
                      left: r.x, top: r.y, width: r.w, height: r.h,
                      borderRadius: state.radius * unit,
                      boxShadow: [
                        state.shadow > 0 ? `0 ${state.shadow * unit * 0.012}px ${state.shadow * unit * 0.04}px rgba(0,0,0,${0.18 + state.shadow * 0.32})` : '',
                        state.borderWidth > 0 ? `inset 0 0 0 ${state.borderWidth * unit}px ${state.borderColor}` : ''
                      ].filter(Boolean).join(', ') || undefined,
                      outline: selected ? '2px solid var(--accent)' : dropCell === cid ? '3px solid var(--accent)' : undefined,
                      outlineOffset: 2,
                      background: m ? undefined : 'color-mix(in srgb, #888 16%, transparent)'
                    }}
                    onPointerDown={(e) => {
                      setSel({ type: 'cell', id: cid })
                      if (!m || (e.target as HTMLElement).closest('[data-grip]')) {
                        e.stopPropagation()
                        return
                      }
                      const ox = (p.w - r.w) / 2, oy = (p.h - r.h) / 2
                      const start = { x: c.panX, y: c.panY }
                      dragPointer(e, (dx, dy) => {
                        setState((s) => ({
                          ...s,
                          cells: { ...s.cells, [cid]: { ...s.cells[cid], panX: ox > 0 ? Math.max(-1, Math.min(1, start.x + dx / ox)) : 0, panY: oy > 0 ? Math.max(-1, Math.min(1, start.y + dy / oy)) : 0 } }
                        }), false)
                      })
                    }}
                    onWheel={(e) => {
                      if (!m) return
                      const z = Math.max(1, Math.min(5, c.zoom * Math.exp(-e.deltaY * 0.0022)))
                      setState((s) => ({ ...s, cells: { ...s.cells, [cid]: { ...s.cells[cid], zoom: z } } }), false)
                    }}
                    onDoubleClick={() => setState((s) => ({ ...s, cells: { ...s.cells, [cid]: { ...s.cells[cid], zoom: 1, panX: 0, panY: 0 } } }))}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(TRAY_MIME) || e.dataTransfer.types.includes(CELL_MIME)) {
                        e.preventDefault()
                        setDropCell(cid)
                      }
                    }}
                    onDragLeave={() => setDropCell((d) => (d === cid ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropCell(null)
                      const tray = e.dataTransfer.getData(TRAY_MIME)
                      const from = e.dataTransfer.getData(CELL_MIME)
                      if (tray) setState((s) => ({ ...s, cells: { ...s.cells, [cid]: { mediaId: parseInt(tray, 10), zoom: 1, panX: 0, panY: 0 } } }))
                      else if (from && from !== cid) setState((s) => ({ ...s, cells: { ...s.cells, [cid]: s.cells[from], [from]: s.cells[cid] ?? { mediaId: null, zoom: 1, panX: 0, panY: 0 } } }))
                      setSel({ type: 'cell', id: cid })
                    }}
                  >
                    {m ? (
                      <img
                        src={sourceUrl(m)}
                        alt=""
                        draggable={false}
                        className="absolute max-w-none pointer-events-none select-none"
                        style={swap ? { left: p.x + (p.w - p.h) / 2, top: p.y + (p.h - p.w) / 2, width: p.h, height: p.w, transform: `rotate(${rot}deg)` } : { left: p.x, top: p.y, width: p.w, height: p.h }}
                        onError={(e) => ((e.target as HTMLImageElement).src = thumbUrl(m.id, m.thumbVersion))}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-[#777] pointer-events-none">
                        <Plus size={Math.min(22, r.w / 6)} />
                        {r.w > 90 && 'Drop a photo'}
                      </div>
                    )}
                    {m && (
                      <div
                        data-grip
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(CELL_MIME, cid)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md bg-black/55 text-white items-center justify-center hidden group-hover:flex cursor-grab"
                        title="Drag to swap with another photo"
                      >
                        <GripVertical size={13} />
                      </div>
                    )}
                  </div>
                )
              })}
            {!isFree &&
              layout.gutters.map((g, i) => (
                <div
                  key={i}
                  className={cx('absolute z-20 group/g', g.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize')}
                  style={
                    g.dir === 'row'
                      ? { left: g.rect.x + g.rect.w / 2 - 6, top: g.rect.y, width: 12, height: g.rect.h }
                      : { left: g.rect.x, top: g.rect.y + g.rect.h / 2 - 6, width: g.rect.w, height: 12 }
                  }
                  onPointerDown={(e) => {
                    let applied = 0
                    dragPointer(e, (dx, dy) => {
                      const d = (g.dir === 'row' ? dx : dy) / g.span
                      const step = d - applied
                      applied = d
                      setState((s) => ({ ...s, tree: resizeAt(s.tree, g.path, g.index, step) }), false)
                    })
                  }}
                  role="separator"
                  aria-label="Resize"
                >
                  <div className={cx('absolute bg-accent rounded-full opacity-0 group-hover/g:opacity-100 transition-opacity', g.dir === 'row' ? 'left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-1 h-10' : 'top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-1 w-10')} />
                </div>
              ))}
            {isFree &&
              [...state.free].sort((a, b) => a.z - b.z).map((f) => {
                const m = items.get(f.mediaId)
                const selected = sel?.type === 'free' && sel.id === f.id
                const r = { x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }
                const p = coverPlacement({ x: 0, y: 0, w: r.w, h: r.h }, imgRatio(f.mediaId), 1, 0, 0)
                const rot = m?.rotation ?? 0
                const swap = rot % 180 !== 0
                return (
                  <div
                    key={f.id}
                    className="absolute overflow-visible"
                    style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: f.z + 1 }}
                    onPointerDown={(e) => {
                      setSel({ type: 'free', id: f.id })
                      const maxZ = Math.max(0, ...state.free.map((x) => x.z))
                      const start = { x: f.x, y: f.y }
                      if (f.z < maxZ) setState((s) => ({ ...s, free: s.free.map((x) => (x.id === f.id ? { ...x, z: maxZ + 1 } : x)) }))
                      dragPointer(e, (dx, dy) => setState((s) => ({ ...s, free: s.free.map((x) => (x.id === f.id ? { ...x, x: start.x + dx / W, y: start.y + dy / H } : x)) }), false))
                    }}
                  >
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        borderRadius: state.radius * unit,
                        boxShadow: [
                          state.shadow > 0 ? `0 ${state.shadow * unit * 0.012}px ${state.shadow * unit * 0.04}px rgba(0,0,0,${0.18 + state.shadow * 0.32})` : '',
                          state.borderWidth > 0 ? `inset 0 0 0 ${state.borderWidth * unit}px ${state.borderColor}` : ''
                        ].filter(Boolean).join(', ') || undefined,
                        outline: selected ? '2px solid var(--accent)' : undefined,
                        outlineOffset: 2
                      }}
                    >
                      {m && (
                        <img
                          src={sourceUrl(m)}
                          alt=""
                          draggable={false}
                          className="absolute max-w-none pointer-events-none"
                          style={swap ? { left: p.x + (p.w - p.h) / 2, top: p.y + (p.h - p.w) / 2, width: p.h, height: p.w, transform: `rotate(${rot}deg)` } : { left: p.x, top: p.y, width: p.w, height: p.h }}
                        />
                      )}
                    </div>
                    {selected && (
                      <div
                        className="absolute -right-2 -bottom-2 h-4 w-4 rounded-full bg-white border-2 border-accent cursor-nwse-resize shadow"
                        onPointerDown={(e) => {
                          const start = { w: f.w, h: f.h }
                          const aspect = (start.w * W) / (start.h * H)
                          dragPointer(e, (dx) => {
                            const w = Math.max(0.06, start.w + dx / W)
                            setState((s) => ({ ...s, free: s.free.map((x) => (x.id === f.id ? { ...x, w, h: (w * W) / aspect / H } : x)) }), false)
                          })
                        }}
                      />
                    )}
                  </div>
                )
              })}
            {state.texts.map((t) => {
              const selected = sel?.type === 'text' && sel.id === t.id
              const editing = editingText === t.id
              return (
                <div
                  key={t.id}
                  className={cx('absolute z-30 whitespace-pre px-1 leading-[1.2]', selected && 'outline-2 outline-dashed outline-accent outline-offset-4', editing ? 'cursor-text' : 'cursor-move')}
                  style={{
                    left: t.x * W,
                    top: t.y * H,
                    transform: `translate(${t.align === 'left' ? '0' : t.align === 'right' ? '-100%' : '-50%'}, -50%)`,
                    fontFamily: FONTS[t.font].css,
                    fontWeight: t.font === 'display' ? 800 : t.weight,
                    letterSpacing: t.font === 'display' ? '-0.03em' : undefined,
                    fontSize: t.size * H,
                    color: t.color,
                    textAlign: t.align,
                    textShadow: t.shadow ? `0 ${t.size * H * 0.05}px ${t.size * H * 0.25}px rgba(0,0,0,.45)` : undefined
                  }}
                  contentEditable={editing}
                  suppressContentEditableWarning
                  onPointerDown={(e) => {
                    if (editing) {
                      e.stopPropagation()
                      return
                    }
                    setSel({ type: 'text', id: t.id })
                    const start = { x: t.x, y: t.y }
                    dragPointer(e, (dx, dy) => updateText(t.id, { x: start.x + dx / W, y: start.y + dy / H }, false))
                  }}
                  onDoubleClick={(e) => {
                    setEditingText(t.id)
                    const el = e.currentTarget
                    setTimeout(() => {
                      el.focus()
                      document.getSelection()?.selectAllChildren(el)
                    }, 0)
                  }}
                  onBlur={(e) => {
                    if (!editing) return
                    setEditingText(null)
                    updateText(t.id, { text: e.currentTarget.innerText.replace(/\n$/, '') || 'Text' })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur()
                  }}
                >
                  {t.text}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Inspector */}
      <aside className="w-[300px] shrink-0 border-l border-line flex flex-col min-h-0" aria-label="Collage settings">
        <div className="flex-1 overflow-y-auto scroll p-4 space-y-5">
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Layout</div>
            <div className="grid grid-cols-5 gap-1.5">
              {TEMPLATES.map((t) => (
                <Tooltip key={t.id} label={t.count ? `${t.label} · ${t.count}` : t.label}>
                  <button
                    onClick={() => setState((s) => applyTemplate(s, t.id))}
                    aria-label={t.label}
                    aria-pressed={state.template === t.id}
                    className={cx('aspect-square rounded-lg p-1 border transition-colors', state.template === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-3 hover:text-fg-2 hover:border-line-strong')}
                  >
                    <TemplateIcon id={t.id} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Canvas</div>
            <Select className="w-full" value={state.aspect} options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))} onChange={(v) => setState((s) => ({ ...s, aspect: v }))} label="Aspect ratio" />
          </div>
          <div className="space-y-3">
            {([
              ['Spacing', 'spacing', 0, 0.06],
              ['Outer margin', 'margin', 0, 0.1],
              ['Corners', 'radius', 0, 0.12],
              ['Shadow', 'shadow', 0, 1],
              ['Border', 'borderWidth', 0, 0.02]
            ] as const).map(([label, key, min, max]) => (
              <div key={key}>
                <div className="flex justify-between text-[12px] mb-0.5"><span className="text-fg-2">{label}</span><span className="text-fg-3 tabular">{Math.round(((state[key] as number) / max) * 100)}</span></div>
                <Slider
                  value={state[key] as number}
                  min={min}
                  max={max}
                  step={(max - min) / 200}
                  label={label}
                  onPointerDown={() => setState((s) => ({ ...s }))}
                  onChange={(v) => setState((s) => ({ ...s, [key]: v }), false)}
                />
              </div>
            ))}
            {state.borderWidth > 0 && (
              <label className="flex items-center justify-between text-[12px] text-fg-2">
                Border color
                <input type="color" value={state.borderColor} onChange={(e) => setState((s) => ({ ...s, borderColor: e.target.value }))} className="h-6 w-10 rounded bg-transparent" aria-label="Border color" />
              </label>
            )}
          </div>
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Background</div>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => (
                <button key={c} aria-label={`Background ${c}`} onClick={() => setState((s) => ({ ...s, background: { ...s.background, color: c, mediaId: null } }))} className={cx('h-6 w-6 rounded-full border border-line-strong', state.background.color === c && state.background.mediaId === null && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--canvas)]')} style={{ background: c }} />
              ))}
              <label className="h-6 w-6 rounded-full border border-line-strong overflow-hidden relative cursor-pointer" title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
                <input type="color" value={state.background.color} onChange={(e) => setState((s) => ({ ...s, background: { ...s.background, color: e.target.value } }))} className="opacity-0 absolute inset-0" aria-label="Custom background color" />
              </label>
            </div>
            <div className="flex gap-2 mt-2.5">
              <Button size="sm" icon={ImageIcon} onClick={pickBackground}>{state.background.mediaId !== null ? 'Change Photo' : 'Use a Photo'}</Button>
              {state.background.mediaId !== null && <Button size="sm" variant="ghost" onClick={() => setState((s) => ({ ...s, background: { ...s.background, mediaId: null } }))}>Remove</Button>}
            </div>
            {state.background.mediaId !== null && (
              <div className="mt-2">
                <div className="text-[12px] text-fg-2 mb-0.5">Blur</div>
                <Slider value={state.background.blur} min={0} max={80} step={1} label="Background blur" onChange={(v) => setState((s) => ({ ...s, background: { ...s.background, blur: v } }), false)} />
              </div>
            )}
          </div>
          {selectedCell?.mediaId !== undefined && selectedCell.mediaId !== null && sel && (
            <div>
              <div className="text-[12px] font-semibold text-fg-2 mb-2">Selected photo</div>
              <div className="text-[12px] text-fg-2 mb-0.5">Zoom</div>
              <Slider value={selectedCell.zoom} min={1} max={5} step={0.01} label="Photo zoom" onChange={(v) => setState((s) => ({ ...s, cells: { ...s.cells, [sel.id]: { ...s.cells[sel.id], zoom: v } } }), false)} />
              <div className="flex gap-2 mt-2">
                <Button size="sm" icon={RotateCcw} onClick={() => setState((s) => ({ ...s, cells: { ...s.cells, [sel.id]: { ...s.cells[sel.id], zoom: 1, panX: 0, panY: 0 } } }))}>Reset Crop</Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setState((s) => ({ ...s, cells: { ...s.cells, [sel.id]: { mediaId: null, zoom: 1, panX: 0, panY: 0 } } }))}>Remove</Button>
              </div>
            </div>
          )}
          {selectedText && (
            <div className="space-y-2.5">
              <div className="flex items-center">
                <div className="text-[12px] font-semibold text-fg-2 flex-1">Text</div>
                <IconButton icon={Trash2} label="Delete text" size={14} onClick={() => { setState((s) => ({ ...s, texts: s.texts.filter((t) => t.id !== selectedText.id) })); setSel(null) }} />
              </div>
              <textarea
                value={selectedText.text}
                onChange={(e) => updateText(selectedText.id, { text: e.target.value }, false)}
                rows={2}
                className="w-full rounded-md bg-input border border-line px-2.5 py-1.5 text-[13px] resize-none focus:border-accent"
                aria-label="Text content"
              />
              <Segmented size="sm" className="w-full" value={selectedText.font} options={(Object.keys(FONTS) as TextLayer['font'][]).map((f) => ({ value: f, label: FONTS[f].label }))} onChange={(v) => updateText(selectedText.id, { font: v })} />
              <div>
                <div className="text-[12px] text-fg-2 mb-0.5">Size</div>
                <Slider value={selectedText.size} min={0.02} max={0.25} step={0.002} label="Text size" onChange={(v) => updateText(selectedText.id, { size: v }, false)} />
              </div>
              <div className="flex items-center gap-2">
                <Segmented size="sm" value={String(selectedText.weight) as '400' | '600' | '800'} options={[{ value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '800', label: 'Bold' }]} onChange={(v) => updateText(selectedText.id, { weight: parseInt(v, 10) as 400 | 600 | 800 })} />
              </div>
              <div className="flex items-center gap-2">
                <Segmented size="sm" value={selectedText.align} options={[{ value: 'left', icon: AlignLeft, title: 'Left' }, { value: 'center', icon: AlignCenter, title: 'Center' }, { value: 'right', icon: AlignRight, title: 'Right' }]} onChange={(v) => updateText(selectedText.id, { align: v })} />
                <input type="color" value={selectedText.color} onChange={(e) => updateText(selectedText.id, { color: e.target.value })} className="h-7 w-10 rounded bg-transparent ml-auto" aria-label="Text color" />
              </div>
              <label className="flex items-center justify-between text-[12px] text-fg-2">
                Shadow
                <Switch checked={selectedText.shadow} onChange={(v) => updateText(selectedText.id, { shadow: v })} label="Text shadow" />
              </label>
              <p className="text-[11px] text-fg-3">Drag the text on the canvas to move it. Double-click to edit in place.</p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-line space-y-3">
          <div className="flex gap-2">
            <Segmented size="sm" className="flex-1" value={format} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WEBP' }]} onChange={setFormat} />
            <Select value={longEdge} options={[1080, 2048, 3000, 4096, 6000].map((n) => ({ value: n, label: `${n}px` }))} onChange={setLongEdge} label="Export size" />
          </div>
          {format !== 'png' && (
            <div>
              <div className="flex justify-between text-[12px] mb-0.5"><span className="text-fg-2">Quality</span><span className="text-fg-3 tabular">{quality}%</span></div>
              <Slider value={quality} min={50} max={100} step={1} onChange={setQuality} label="Export quality" />
            </div>
          )}
          <label className="flex items-center justify-between text-[12px] text-fg-2">
            Add to library after export
            <Switch checked={addToLibrary} onChange={setAddToLibrary} label="Add to library" />
          </label>
          <Button className="w-full" size="lg" variant="primary" icon={exporting ? undefined : Download} disabled={exporting || !usedMedia.size} onClick={() => void doExport()}>
            {exporting ? <><Spinner size={14} /> Exporting…</> : 'Export…'}
          </Button>
        </div>
      </aside>
    </div>
  )
}
