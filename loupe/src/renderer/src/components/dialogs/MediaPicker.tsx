import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Check } from 'lucide-react'
import type { LayoutResult } from '@shared/types'
import { FLAG_THUMB, FLAG_VIDEO, rotationFromFlags } from '@shared/types'
import { call, thumbUrl } from '../../lib/api'
import { Button, Modal, TextInput } from '../ui/controls'
import { cx } from '../../lib/cx'
import { count } from '../../lib/format'

/** Pick photos from the library (used by Collage Studio). */
export function MediaPicker({ title, multiple = true, photosOnly = true, onPick, onClose }: { title: string; multiple?: boolean; photosOnly?: boolean; onPick: (ids: number[]) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [top, setTop] = useState(0)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<number | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      void call('media.layout', { view: { type: photosOnly ? 'photos' : 'all' }, search: search || undefined, sort: 'date', dir: 'desc' }).then(setLayout)
    }, search ? 150 : 0)
    return () => window.clearTimeout(t)
  }, [search, photosOnly])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cell = 112
  const gap = 6
  const cols = Math.max(1, Math.floor((size.w - 16 + gap) / (cell + gap)))
  const cw = (size.w - 16 - (cols - 1) * gap) / cols
  const rows = Math.ceil((layout?.total ?? 0) / cols)
  const startRow = Math.max(0, Math.floor(top / (cw + gap)) - 2)
  const endRow = Math.min(rows, Math.ceil((top + size.h) / (cw + gap)) + 2)
  const pickedSet = useMemo(() => new Set(picked), [picked])

  const toggle = (id: number, index: number, shift: boolean): void => {
    if (!multiple) {
      onPick([id])
      return
    }
    if (shift && last.current !== null && layout) {
      const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)]
      const range = Array.from(layout.ids.slice(a, b + 1))
      setPicked((p) => [...p, ...range.filter((x) => !p.includes(x))])
    } else setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    last.current = index
  }

  return (
    <Modal onClose={onClose} width={Math.min(window.innerWidth - 80, 980)} className="h-[80vh]" labelledBy="dialog-title">
      <div className="px-6 pt-5 pb-3 flex items-center gap-4">
        <h2 id="dialog-title" className="text-[16px] font-semibold">{title}</h2>
        <TextInput className="flex-1 max-w-[360px] ml-auto" icon={Search} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} data-autofocus />
      </div>
      <div ref={ref} className="flex-1 min-h-0 overflow-y-auto scroll px-2" onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        {layout && layout.total === 0 && <div className="py-16 text-center text-fg-3 text-[13px]">No photos found.</div>}
        <div className="relative" style={{ height: rows * (cw + gap) }}>
          {layout &&
            Array.from({ length: Math.max(0, endRow - startRow) * cols }, (_, k) => {
              const i = startRow * cols + k
              if (i >= layout.total) return null
              const id = layout.ids[i]
              const f = layout.flags[i]
              const sel = pickedSet.has(id)
              const r = Math.floor(i / cols), c = i % cols
              return (
                <button
                  key={id}
                  onClick={(e) => toggle(id, i, e.shiftKey)}
                  onDoubleClick={() => onPick(multiple ? [...new Set([...picked, id])] : [id])}
                  className={cx('absolute rounded-md overflow-hidden bg-thumb transition-shadow', sel && 'shadow-[0_0_0_3px_var(--accent)]')}
                  style={{ left: 8 + c * (cw + gap), top: r * (cw + gap), width: cw, height: cw }}
                  aria-pressed={sel}
                >
                  {f & FLAG_THUMB ? <img src={thumbUrl(id)} alt="" loading="lazy" className="h-full w-full object-cover" style={{ transform: rotationFromFlags(f) ? `rotate(${rotationFromFlags(f)}deg)` : undefined }} /> : <div className="h-full w-full shimmer" />}
                  {f & FLAG_VIDEO ? <span className="absolute bottom-1 right-1 text-[10px] text-white font-semibold drop-shadow">VIDEO</span> : null}
                  {sel && (
                    <span className="absolute top-1.5 right-1.5 h-5 min-w-5 px-1 rounded-full bg-accent text-white text-[10.5px] font-bold flex items-center justify-center shadow">
                      {multiple ? picked.indexOf(id) + 1 : <Check size={11} />}
                    </span>
                  )}
                </button>
              )
            })}
        </div>
      </div>
      <div className="px-6 py-4 flex items-center gap-2 border-t border-line">
        <span className="text-[12.5px] text-fg-3 mr-auto">{multiple ? 'Click to select, Shift-click for a range.' : 'Click a photo to choose it.'}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {multiple && (
          <Button variant="primary" disabled={!picked.length} onClick={() => onPick(picked)}>
            {picked.length ? `Add ${count(picked.length, 'Photo')}` : 'Add Photos'}
          </Button>
        )}
      </div>
    </Modal>
  )
}
