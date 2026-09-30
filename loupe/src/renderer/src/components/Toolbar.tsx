import { useEffect, useRef, useState } from 'react'
import {
  Search, X, Plus, SlidersHorizontal, PanelLeftOpen, Info, LayoutGrid, Rows3, LayoutDashboard, Square, GalleryHorizontal,
  CalendarDays, List, Hash, Images, Folder, Calendar, Film, Camera, ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, Undo2, Redo2
} from 'lucide-react'
import type { InfoFields, LayoutMode, SearchSuggestion, SortKey } from '@shared/types'
import { useApp, viewTitle } from '../store/app'
import { useGallery, currentView, effectiveSort } from '../store/gallery'
import { useUI } from '../store/ui'
import { call, isMac, mod } from '../lib/api'
import { cx } from '../lib/cx'
import { Button, Checkbox, IconButton, Popover, Segmented, Select, Slider, Switch } from './ui/controls'
import * as actions from '../lib/actions'

const LAYOUTS: { value: LayoutMode; icon: typeof LayoutGrid; title: string }[] = [
  { value: 'grid', icon: LayoutGrid, title: 'Grid' },
  { value: 'masonry', icon: LayoutDashboard, title: 'Masonry' },
  { value: 'large', icon: Square, title: 'Large thumbnails' },
  { value: 'filmstrip', icon: GalleryHorizontal, title: 'Filmstrip' },
  { value: 'timeline', icon: CalendarDays, title: 'Timeline' },
  { value: 'list', icon: List, title: 'List' }
]

const INFO_LABELS: [keyof InfoFields, string][] = [
  ['filename', 'Filename'],
  ['date', 'Date'],
  ['type', 'File type'],
  ['resolution', 'Resolution'],
  ['size', 'File size'],
  ['duration', 'Video duration'],
  ['folder', 'Folder'],
  ['rating', 'Rating'],
  ['tags', 'Tags']
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Date taken' },
  { value: 'added', label: 'Date added' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'File size' },
  { value: 'rating', label: 'Rating' },
  { value: 'type', label: 'Type' }
]

function ViewOptions({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const route = useApp((s) => s.route)
  useGallery((s) => s.sortOverrides)
  const view = currentView()
  if (!view) return null
  const sort = effectiveSort(view)
  const sorts = view.type === 'album' ? [{ value: 'manual' as SortKey, label: 'Custom order' }, ...SORTS] : view.type === 'recent-viewed' ? [{ value: 'viewed' as SortKey, label: 'Last viewed' }, ...SORTS] : SORTS
  void route
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={316} className="p-4">
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3 mb-2">Layout</div>
          <Segmented value={prefs.layout} options={LAYOUTS} onChange={(v) => setPrefs({ layout: v })} className="w-full" />
        </div>
        {prefs.layout !== 'list' && prefs.layout !== 'filmstrip' && (
          <div>
            <div className="flex items-center justify-between text-[12.5px] mb-1">
              <span className="text-fg-2">Thumbnail size</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Square size={11} className="text-fg-3" />
              <Slider value={prefs.thumbSize} min={96} max={420} step={2} label="Thumbnail size" onChange={(v) => setPrefs({ thumbSize: v })} />
              <Square size={16} className="text-fg-3" />
            </div>
          </div>
        )}
        {prefs.layout !== 'list' && (
          <div>
            <div className="text-[12.5px] text-fg-2 mb-1.5">Spacing</div>
            <Segmented
              value={prefs.density}
              size="sm"
              className="w-full"
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'spacious', label: 'Spacious' }
              ]}
              onChange={(v) => setPrefs({ density: v })}
            />
          </div>
        )}
        {prefs.layout === 'grid' || prefs.layout === 'timeline' ? (
          <label className="flex items-center justify-between text-[12.5px] text-fg-2">
            Crop to squares
            <Switch checked={prefs.squareThumbs} onChange={(v) => setPrefs({ squareThumbs: v })} label="Crop to squares" />
          </label>
        ) : null}
        {view.type !== 'deleted' && (
          <div>
            <div className="text-[12.5px] text-fg-2 mb-1.5">Sort by</div>
            <div className="flex gap-2">
              <Select className="flex-1" value={sort.sort} options={sorts} onChange={(v) => useGallery.getState().setSort(v, sort.dir)} label="Sort by" />
              <IconButton
                icon={sort.dir === 'desc' ? ArrowDownWideNarrow : ArrowUpNarrowWide}
                label={sort.dir === 'desc' ? 'Newest / largest first' : 'Oldest / smallest first'}
                onClick={() => useGallery.getState().setSort(sort.sort, sort.dir === 'desc' ? 'asc' : 'desc')}
                className="border border-line"
              />
            </div>
          </div>
        )}
        {prefs.layout !== 'filmstrip' && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3 mb-2">Show on thumbnails</div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-3">
              {INFO_LABELS.map(([k, label]) => (
                <Checkbox key={k} checked={prefs.info[k]} onChange={(v) => setPrefs({ info: { ...prefs.info, [k]: v } })} label={<span className="text-[12.5px] text-fg-2">{label}</span>} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Popover>
  )
}

const SUGGEST_ICON: Record<SearchSuggestion['kind'], typeof Hash> = {
  tag: Hash, album: Images, folder: Folder, year: Calendar, month: Calendar, type: Film, camera: Camera
}

function SearchField() {
  const search = useGallery((s) => s.search)
  const focusTick = useUI((s) => s.searchFocusTick)
  const route = useApp((s) => s.route)
  const [text, setText] = useState(search)
  const [focused, setFocused] = useState(false)
  const [sugs, setSugs] = useState<SearchSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => setText(search), [search])
  useEffect(() => {
    if (focusTick) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [focusTick])

  const apply = (v: string, immediate = false): void => {
    setText(v)
    if (timer.current) window.clearTimeout(timer.current)
    const run = (): void => {
      useGallery.getState().setSearch(v)
      void useGallery.getState().reload()
    }
    if (immediate) run()
    else timer.current = window.setTimeout(run, 140)
    if (v.trim()) void call('search.suggest', v).then((s) => setSugs(s)).catch(() => setSugs([]))
    else setSugs([])
    setActive(-1)
  }

  const choose = (s: SearchSuggestion): void => {
    const parts = text.split(/\s+/)
    parts[parts.length - 1] = s.token
    apply(parts.join(' ') + ' ', true)
    setSugs([])
    ref.current?.focus()
  }

  const view = route.kind === 'view' ? route.view : null
  const scoped = view && !['all', 'timeline', 'photos', 'videos'].includes(view.type)
  const appState = useApp.getState()

  return (
    <div className="relative w-full max-w-[440px]" data-no-drag>
      <div className={cx('flex items-center h-8 rounded-lg border transition-all duration-150', focused ? 'bg-raised border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]' : 'bg-input border-transparent hover:border-line-strong')}>
        <Search size={15} strokeWidth={1.9} className="ml-2.5 text-fg-3 shrink-0" />
        {scoped && text && view && (
          <button
            className="ml-2 h-5 px-1.5 rounded bg-active text-[11px] text-fg-2 whitespace-nowrap flex items-center gap-1 max-w-[140px] hover:bg-line-strong"
            onClick={() => appState.navigate({ kind: 'view', view: { type: 'all' } })}
            title="Search all media instead"
          >
            <span className="truncate">in {viewTitle(view, appState)}</span>
            <X size={10} />
          </button>
        )}
        <input
          ref={ref}
          value={text}
          spellCheck={false}
          placeholder="Search photos, places, tags, dates…"
          aria-label="Search"
          className="flex-1 min-w-0 bg-transparent px-2 text-[13px] placeholder:text-fg-3"
          onChange={(e) => apply(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              if (text) apply('', true)
              else ref.current?.blur()
            } else if (e.key === 'ArrowDown' && sugs.length) {
              e.preventDefault()
              setActive((a) => Math.min(sugs.length - 1, a + 1))
            } else if (e.key === 'ArrowUp' && sugs.length) {
              e.preventDefault()
              setActive((a) => Math.max(-1, a - 1))
            } else if (e.key === 'Enter') {
              if (active >= 0 && sugs[active]) choose(sugs[active])
              else {
                apply(text, true)
                setSugs([])
                ref.current?.blur()
                document.querySelector<HTMLElement>('[data-gallery-scroller]')?.focus()
              }
            }
          }}
        />
        {text ? (
          <button aria-label="Clear search" className="mr-1.5 h-5 w-5 rounded-full flex items-center justify-center text-fg-3 hover:text-fg hover:bg-hover" onClick={() => apply('', true)}>
            <X size={13} />
          </button>
        ) : (
          <span className="mr-2.5 text-[11px] text-fg-3 whitespace-nowrap">{mod} F</span>
        )}
      </div>
      {focused && sugs.length > 0 && (
        <div className="absolute top-10 left-0 right-0 z-[110] py-1 rounded-xl bg-overlay shadow-pop anim-pop" role="listbox">
          {sugs.map((s, i) => {
            const Icon = SUGGEST_ICON[s.kind]
            return (
              <button
                key={`${s.kind}:${s.token}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={cx('w-[calc(100%-8px)] mx-1 h-8 px-2.5 rounded-md flex items-center gap-2.5 text-left text-[13px]', i === active && 'bg-hover')}
              >
                <Icon size={14} className="text-fg-3 shrink-0" />
                <span className="truncate">{s.label}</span>
                {s.detail && <span className="text-fg-3 text-[12px] truncate">{s.detail}</span>}
                <span className="ml-auto text-[11px] text-fg-3 capitalize shrink-0">
                  {s.kind}
                  {s.count !== undefined ? ` · ${s.count.toLocaleString()}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Toolbar() {
  const route = useApp((s) => s.route)
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const back = useApp((s) => s.back)
  const goBack = useApp((s) => s.goBack)
  const hist = useApp((s) => s.history)
  const total = useGallery((s) => s.layout?.total ?? 0)
  const search = useGallery((s) => s.search)
  const loading = useGallery((s) => s.loading)
  const selection = useGallery((s) => s.selection.size)
  const infoPanel = useUI((s) => s.infoPanel)
  const appState = useApp()
  const [optsOpen, setOptsOpen] = useState(false)
  const optsBtn = useRef<HTMLButtonElement>(null)
  const isView = route.kind === 'view'
  const title = isView
    ? viewTitle(route.view, appState)
    : route.kind === 'settings' ? 'Settings' : route.kind === 'converter' ? 'Image Converter' : route.kind === 'collage' ? 'Collage Studio' : 'Duplicates'

  const layoutIcon = LAYOUTS.find((l) => l.value === prefs.layout)?.icon ?? Rows3

  return (
    <header
      className={cx(
        'drag-region h-12 shrink-0 flex items-center gap-3 border-b border-line titlebar-pad-right',
        prefs.sidebarCollapsed && isMac ? 'pl-[84px]' : 'pl-3'
      )}
    >
      {prefs.sidebarCollapsed && (
        <IconButton icon={PanelLeftOpen} label={`Show sidebar (${mod}\\)`} onClick={() => setPrefs({ sidebarCollapsed: false })} />
      )}
      {back.length > 0 && !isView && <IconButton icon={ChevronLeft} label="Back" onClick={goBack} />}
      <div className="min-w-0 flex items-baseline gap-2 shrink pl-1">
        <h1 className="text-[14px] font-semibold tracking-[-0.01em] truncate">{title}</h1>
        {isView && (
          <span className={cx('text-[12px] text-fg-3 tabular whitespace-nowrap transition-opacity', loading && 'opacity-60')}>
            {selection > 0 ? `${selection.toLocaleString()} of ${total.toLocaleString()} selected` : search ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}` : `${total.toLocaleString()} item${total === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
      <div className="flex-1 flex justify-center min-w-[160px]">{isView && <SearchField />}</div>
      <div className="flex items-center gap-1 shrink-0">
        {hist.canUndo && isView && (
          <IconButton icon={Undo2} label={`Undo ${hist.undoLabel ?? ''} (${mod}Z)`} onClick={() => void actions.undo()} />
        )}
        {hist.canRedo && isView && <IconButton icon={Redo2} label={`Redo ${hist.redoLabel ?? ''}`} onClick={() => void actions.redo()} />}
        {isView && (
          <>
            <IconButton ref={optsBtn} icon={optsOpen ? SlidersHorizontal : layoutIcon} label="View options" active={optsOpen} onClick={() => setOptsOpen(!optsOpen)} />
            <ViewOptions anchor={optsBtn.current} open={optsOpen} onClose={() => setOptsOpen(false)} />
            <IconButton icon={Info} label={`Info (${mod}I)`} active={infoPanel} onClick={() => useUI.setState({ infoPanel: !infoPanel })} />
          </>
        )}
        <Button variant="primary" size="sm" icon={Plus} className="ml-1.5" onClick={() => void actions.importViaPicker(false)} title={`Import (${mod}O)`}>
          Import
        </Button>
      </div>
    </header>
  )
}
