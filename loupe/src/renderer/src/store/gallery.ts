// The current gallery view: query, compact layout index and selection.

import { create } from 'zustand'
import type { LayoutResult, MediaQuery, SortDir, SortKey, ViewSpec } from '@shared/types'
import { call } from '../lib/api'
import { useApp } from './app'

interface GalleryState {
  search: string
  sortOverrides: Record<string, { sort: SortKey; dir: SortDir }>
  layout: LayoutResult | null
  indexOf: Map<number, number>
  queryKey: string
  loading: boolean
  loadedOnce: boolean
  selection: Set<number>
  anchor: number | null
  focus: number | null
  setSearch(s: string): void
  reload(): Promise<void>
  setSort(sort: SortKey, dir: SortDir): void
  selectOnly(id: number | null): void
  toggle(id: number): void
  selectRange(toId: number, additive: boolean): void
  setSelection(ids: Iterable<number>, focus?: number | null): void
  selectAll(): void
  clear(): void
  setFocus(id: number | null): void
}

export function viewKey(v: ViewSpec): string {
  switch (v.type) {
    case 'album': return `album:${v.id}`
    case 'tag': return `tag:${v.id}`
    case 'folder': return `folder:${v.ids.join(',')}:${v.recursive}`
    case 'import': return `import:${v.id}`
    default: return v.type
  }
}

function defaultSort(v: ViewSpec): { sort: SortKey; dir: SortDir } | null {
  switch (v.type) {
    case 'recent-added': return { sort: 'added', dir: 'desc' }
    case 'recent-viewed': return { sort: 'viewed', dir: 'desc' }
    case 'album': return { sort: 'manual', dir: 'asc' }
    case 'deleted': return { sort: 'date', dir: 'desc' }
    default: return null
  }
}

export function currentView(): ViewSpec | null {
  const r = useApp.getState().route
  return r.kind === 'view' ? r.view : null
}

export function effectiveSort(v: ViewSpec): { sort: SortKey; dir: SortDir } {
  const g = useGallery.getState()
  const o = g.sortOverrides[viewKey(v)]
  if (o) return o
  const d = defaultSort(v)
  if (d) return d
  const p = useApp.getState().prefs
  if (v.type === 'timeline') return { sort: 'date', dir: p?.sortDir ?? 'desc' }
  return { sort: p?.sort ?? 'date', dir: p?.sortDir ?? 'desc' }
}

export function currentQuery(): MediaQuery | null {
  const v = currentView()
  if (!v) return null
  const { sort, dir } = effectiveSort(v)
  return { view: v, search: useGallery.getState().search.trim() || undefined, sort, dir }
}

let requestSeq = 0

export const useGallery = create<GalleryState>((set, get) => ({
  search: '',
  sortOverrides: {},
  layout: null,
  indexOf: new Map(),
  queryKey: '',
  loading: false,
  loadedOnce: false,
  selection: new Set(),
  anchor: null,
  focus: null,

  setSearch(s) {
    set({ search: s })
  },

  async reload() {
    const q = currentQuery()
    if (!q || !useApp.getState().library) return
    const seq = ++requestSeq
    const key = JSON.stringify(q)
    set({ loading: true })
    try {
      const layout = await call('media.layout', q)
      if (seq !== requestSeq) return
      const indexOf = new Map<number, number>()
      for (let i = 0; i < layout.ids.length; i++) indexOf.set(layout.ids[i], i)
      const sel = get().selection
      let selection = sel
      if (sel.size) {
        selection = new Set([...sel].filter((id) => indexOf.has(id)))
      }
      const focus = get().focus !== null && indexOf.has(get().focus!) ? get().focus : null
      const anchor = get().anchor !== null && indexOf.has(get().anchor!) ? get().anchor : null
      set({ layout, indexOf, queryKey: key, loading: false, loadedOnce: true, selection, focus, anchor })
    } catch (err) {
      console.error(err)
      if (seq === requestSeq) set({ loading: false })
    }
  },

  setSort(sort, dir) {
    const v = currentView()
    if (!v) return
    const special = defaultSort(v)
    if (special || v.type === 'album') {
      set({ sortOverrides: { ...get().sortOverrides, [viewKey(v)]: { sort, dir } } })
    } else {
      useApp.getState().setPrefs({ sort, sortDir: dir })
    }
    void get().reload()
  },

  selectOnly(id) {
    set({ selection: id === null ? new Set() : new Set([id]), anchor: id, focus: id })
  },

  toggle(id) {
    const s = new Set(get().selection)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    set({ selection: s, anchor: id, focus: id })
  },

  selectRange(toId, additive) {
    const { layout, indexOf, anchor } = get()
    if (!layout) return
    const a = anchor !== null ? (indexOf.get(anchor) ?? 0) : 0
    const b = indexOf.get(toId) ?? 0
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const s = additive ? new Set(get().selection) : new Set<number>()
    for (let i = lo; i <= hi; i++) s.add(layout.ids[i])
    set({ selection: s, focus: toId })
  },

  setSelection(ids, focus) {
    const s = new Set(ids)
    set({ selection: s, focus: focus === undefined ? get().focus : focus })
  },

  selectAll() {
    const l = get().layout
    if (!l) return
    set({ selection: new Set(l.ids) })
  },

  clear() {
    set({ selection: new Set(), anchor: null })
  },

  setFocus(id) {
    set({ focus: id })
  }
}))

/** Selected ids in gallery order (falls back to the focused item). */
export function selectedIds(): number[] {
  const { selection, layout, indexOf, focus } = useGallery.getState()
  if (!selection.size) return focus !== null ? [focus] : []
  if (!layout) return [...selection]
  if (selection.size === layout.ids.length) return Array.from(layout.ids)
  return [...selection].sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0))
}
