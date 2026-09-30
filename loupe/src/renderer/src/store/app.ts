// Global app state: preferences, the open library, navigation, sidebar data,
// background activity and undo availability.

import { create } from 'zustand'
import type {
  ActivityStatus, Album, AppInfo, FolderNode, HistoryState, LibraryCounts, LibraryInfo, Preferences, ViewSpec
} from '@shared/types'
import { call } from '../lib/api'

export type Route =
  | { kind: 'view'; view: ViewSpec }
  | { kind: 'settings'; section?: string }
  | { kind: 'converter' }
  | { kind: 'collage' }
  | { kind: 'duplicates' }

export const EMPTY_COUNTS: LibraryCounts = { all: 0, photos: 0, videos: 0, favorites: 0, deleted: 0, recentAdded: 0, recentViewed: 0 }

interface AppState {
  phase: 'loading' | 'welcome' | 'library'
  launch: { lastPath: string | null; missing: boolean; recent: string[] } | null
  info: AppInfo | null
  library: LibraryInfo | null
  prefs: Preferences | null
  route: Route
  back: Route[]
  albums: Album[]
  tags: { id: number; name: string; count: number }[]
  folders: FolderNode[]
  counts: LibraryCounts
  activity: ActivityStatus
  history: HistoryState
  justCreated: boolean
  fullscreen: boolean
  systemDark: boolean
  setPrefs(patch: Partial<Preferences>): void
  navigate(route: Route): void
  goBack(): void
  refreshStructure(): Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  phase: 'loading',
  launch: null,
  info: null,
  library: null,
  prefs: null,
  route: { kind: 'view', view: { type: 'all' } },
  back: [],
  albums: [],
  tags: [],
  folders: [],
  counts: EMPTY_COUNTS,
  activity: { import: null, processing: { done: 0, total: 0, paused: false, failed: 0 }, task: null },
  history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null },
  justCreated: false,
  fullscreen: false,
  systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,

  setPrefs(patch) {
    const cur = get().prefs
    if (!cur) return
    const next = { ...cur, ...patch } as Preferences
    for (const k of ['info', 'viewer', 'metadata', 'converter', 'sidebarSections'] as const) {
      if (patch[k]) (next as unknown as Record<string, unknown>)[k] = { ...(cur[k] as object), ...(patch[k] as object) }
    }
    set({ prefs: next })
    void call('app.setPrefs', patch)
  },

  navigate(route) {
    const cur = get().route
    if (JSON.stringify(cur) === JSON.stringify(route)) return
    set({ route, back: [...get().back.slice(-30), cur] })
  },

  goBack() {
    const back = get().back
    if (!back.length) return
    set({ route: back[back.length - 1], back: back.slice(0, -1) })
  },

  async refreshStructure() {
    if (!get().library) return
    const [albums, tags, folders, counts] = await Promise.all([
      call('albums.list'),
      call('tags.list'),
      call('folders.tree'),
      call('library.counts')
    ])
    set({ albums, tags, folders, counts })
  }
}))

export function viewTitle(view: ViewSpec, s: Pick<AppState, 'albums' | 'tags' | 'folders'>): string {
  switch (view.type) {
    case 'all': return 'All Media'
    case 'photos': return 'Photos'
    case 'videos': return 'Videos'
    case 'favorites': return 'Favorites'
    case 'recent-added': return 'Recently Added'
    case 'recent-viewed': return 'Recently Viewed'
    case 'timeline': return 'Timeline'
    case 'deleted': return 'Recently Deleted'
    case 'import': return 'Last Import'
    case 'album': return s.albums.find((a) => a.id === view.id)?.name ?? 'Album'
    case 'tag': return `#${s.tags.find((t) => t.id === view.id)?.name ?? 'Tag'}`
    case 'folder': {
      if (view.ids.length > 1) return `${view.ids.length} Folders`
      return s.folders.find((f) => f.id === view.ids[0])?.name ?? 'Folder'
    }
  }
}

export function isDark(): boolean {
  const { prefs, systemDark } = useApp.getState()
  const t = prefs?.theme ?? 'system'
  return t === 'dark' || (t === 'system' && systemDark)
}
