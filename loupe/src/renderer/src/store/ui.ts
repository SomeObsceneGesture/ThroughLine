// Transient UI state: viewer, context menu, dialogs, toasts, tool inputs.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import type { ConvertJobItem, ExternalFile } from '@shared/types'

export interface MenuItem {
  label?: string
  icon?: LucideIcon
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  submenu?: MenuItem[]
  onSelect?: () => void
}

export interface ViewerState {
  open: boolean
  mode: 'library' | 'external'
  ids: number[]
  external: ExternalFile[]
  index: number
  slideshow: boolean
  origin: DOMRect | null
  /** Increments on every open so stale close animations can't close a newer viewer. */
  session: number
}

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error' | 'success'
  detail?: string
  action?: { label: string; run: () => void }
  progress?: number
  sticky?: boolean
}

export interface DialogEntry {
  id: number
  render: (close: () => void) => ReactNode
}

interface UIState {
  viewer: ViewerState
  menu: { x: number; y: number; items: MenuItem[] } | null
  dialogs: DialogEntry[]
  toasts: Toast[]
  infoPanel: boolean
  searchFocusTick: number
  converterItems: ConvertJobItem[]
  collageIds: number[]
  dragActive: 'files' | 'media' | null
  openViewer(ids: number[], index: number, origin?: DOMRect | null, slideshow?: boolean): void
  openExternal(files: ExternalFile[], index: number): void
  closeViewer(): void
  setViewerIndex(i: number): void
  setSlideshow(v: boolean): void
  showMenu(x: number, y: number, items: MenuItem[]): void
  hideMenu(): void
  openDialog(render: DialogEntry['render']): number
  closeDialog(id: number): void
  toast(t: Omit<Toast, 'id'> & { duration?: number }): number
  updateToast(id: number, patch: Partial<Toast>): void
  dismissToast(id: number): void
  focusSearch(): void
}

let nextId = 1

export const useUI = create<UIState>((set, get) => ({
  viewer: { open: false, mode: 'library', ids: [], external: [], index: 0, slideshow: false, origin: null, session: 0 },
  menu: null,
  dialogs: [],
  toasts: [],
  infoPanel: false,
  searchFocusTick: 0,
  converterItems: [],
  collageIds: [],
  dragActive: null,

  openViewer(ids, index, origin = null, slideshow = false) {
    set({ viewer: { open: true, mode: 'library', ids, external: [], index: Math.max(0, Math.min(index, ids.length - 1)), slideshow, origin, session: get().viewer.session + 1 } })
  },
  openExternal(files, index) {
    set({ viewer: { open: true, mode: 'external', ids: [], external: files, index, slideshow: false, origin: null, session: get().viewer.session + 1 } })
  },
  closeViewer() {
    set({ viewer: { ...get().viewer, open: false, slideshow: false } })
  },
  setViewerIndex(i) {
    set({ viewer: { ...get().viewer, index: i, origin: null } })
  },
  setSlideshow(v) {
    set({ viewer: { ...get().viewer, slideshow: v } })
  },
  showMenu(x, y, items) {
    set({ menu: { x, y, items } })
  },
  hideMenu() {
    set({ menu: null })
  },
  openDialog(render) {
    const id = nextId++
    set({ dialogs: [...get().dialogs, { id, render }] })
    return id
  },
  closeDialog(id) {
    set({ dialogs: get().dialogs.filter((d) => d.id !== id) })
  },
  toast({ duration, ...t }) {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] })
    if (!t.sticky) setTimeout(() => get().dismissToast(id), duration ?? (t.action ? 6500 : 4000))
    return id
  },
  updateToast(id, patch) {
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  focusSearch() {
    set({ searchFocusTick: get().searchFocusTick + 1 })
  }
}))

export const toast = (message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {}): number =>
  useUI.getState().toast({ kind: 'info', message, ...opts })
