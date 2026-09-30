// The typed IPC contract. Every method is invoked from the renderer through a
// single 'api' channel and implemented in src/main/ipc.ts.

import type {
  ActivityStatus, Album, AppInfo, ConvertJobItem, ConvertOptions, ConvertProgress,
  DuplicateScanResult, ExternalFile, FolderNode, HistoryState, ImportRequest, ImportSummary,
  LayoutResult, LibraryChange, LibraryCounts, LibraryInfo, LibraryOpenResult, LibraryStats,
  MediaDetails, MediaItem, MediaQuery, PlayableInfo, Preferences, ScanPreview, SearchSuggestion,
  Storyboard, Tag
} from './types'

export interface Api {
  'app.info'(): AppInfo
  'app.getPrefs'(): Preferences
  'app.setPrefs'(patch: Partial<Preferences>): Preferences
  'app.showItemInFolder'(path: string): void
  'app.openPath'(path: string): string
  'app.copyText'(text: string): void
  'app.chooseDirectory'(opts: { title: string; defaultPath?: string; buttonLabel?: string }): string | null
  'app.chooseFiles'(opts: { title: string; directories?: boolean; media?: boolean }): string[]
  'app.setTitleBarTheme'(opts: { color: string; symbolColor: string }): void
  'app.relaunch'(): void
  'app.consumeLaunchPaths'(): string[]
  'app.setFullScreen'(value: boolean): void
  'app.isFullScreen'(): boolean

  'library.current'(): LibraryInfo | null
  'library.launchState'(): { lastPath: string | null; missing: boolean; recent: string[] }
  'library.defaultLocation'(): string
  'library.create'(parentDir: string, name: string): LibraryOpenResult
  'library.open'(path: string): LibraryOpenResult
  'library.counts'(): LibraryCounts
  'library.stats'(): LibraryStats
  'library.forgetRecent'(path: string): void

  'media.layout'(q: MediaQuery): LayoutResult
  'media.items'(ids: number[]): MediaItem[]
  'media.details'(id: number): MediaDetails | null
  'media.setFavorite'(ids: number[], value: boolean): void
  'media.setRating'(ids: number[], rating: number): void
  'media.rotate'(ids: number[], delta: number): void
  'media.trash'(ids: number[]): number
  'media.restore'(ids: number[]): number
  'media.deletePermanently'(ids: number[], moveFilesToTrash: boolean): { removed: number; trashed: number; errors: string[] }
  'media.rename'(id: number, name: string): { ok: boolean; error?: string; name?: string }
  'media.move'(ids: number[], destDir: string): { moved: number; errors: string[] }
  'media.markViewed'(id: number): void
  'media.prioritize'(ids: number[]): void
  'media.regenerateThumbs'(ids: number[]): void
  'media.paths'(ids: number[]): string[]
  'media.previewUrl'(id: number): string
  'media.fullUrl'(id: number): string
  'media.findByPath'(path: string): number | null
  'media.idsForQuery'(q: MediaQuery): number[]

  'albums.list'(): Album[]
  'albums.create'(name: string, mediaIds?: number[]): Album
  'albums.rename'(id: number, name: string): void
  'albums.delete'(id: number): void
  'albums.addItems'(id: number, mediaIds: number[]): number
  'albums.removeItems'(id: number, mediaIds: number[]): number
  'albums.reorder'(id: number, mediaIds: number[], beforeId: number | null): void
  'albums.setCover'(id: number, mediaId: number): void
  'albums.forMedia'(ids: number[]): { id: number; name: string; count: number }[]

  'tags.list'(): Tag[]
  'tags.add'(mediaIds: number[], names: string[]): number
  'tags.remove'(mediaIds: number[], tagIds: number[]): number
  'tags.rename'(id: number, name: string): { ok: boolean; error?: string }
  'tags.delete'(id: number): void
  'tags.forMedia'(ids: number[]): { id: number; name: string; count: number }[]

  'folders.tree'(): FolderNode[]
  'folders.rescan'(ids: number[]): void
  'folders.remove'(ids: number[]): number
  'folders.relocate'(id: number, newPath: string): { ok: boolean; error?: string; found?: number }
  'folders.createAlbum'(ids: number[]): Album

  'import.preview'(paths: string[]): ScanPreview
  'import.start'(req: ImportRequest): number
  'import.startForced'(req: ImportRequest): number
  'import.cancel'(): void

  'activity.status'(): ActivityStatus
  'activity.setPaused'(paused: boolean): void

  'search.suggest'(text: string): SearchSuggestion[]

  'history.undo'(): string | null
  'history.redo'(): string | null
  'history.state'(): HistoryState

  'video.storyboard'(id: number): Storyboard | null
  'video.playable'(id: number, canPlayDirect: boolean): PlayableInfo
  'video.cancelTranscode'(id: number): void
  'video.probeCodec'(id: number): { codec?: string; container?: string; audioCodec?: string } | null

  'convert.expand'(paths: string[]): ConvertJobItem[]
  'convert.fromMedia'(ids: number[]): ConvertJobItem[]
  'convert.start'(items: ConvertJobItem[], opts: ConvertOptions): number
  'convert.cancel'(jobId: number): void

  'external.open'(paths: string[]): { files: ExternalFile[]; startIndex: number }
  'external.thumbUrl'(path: string): string
  'external.allow'(paths: string[]): void

  'collage.save'(data: Uint8Array, format: 'jpeg' | 'png' | 'webp', suggestedName: string, addToLibrary: boolean): { path: string } | null
  'collage.imageUrl'(id: number): string

  'duplicates.scan'(opts: { similar: boolean; threshold: number }): DuplicateScanResult
  'duplicates.ignore'(ids: number[]): void

  'backup.create'(): { path: string } | null
  'backup.restore'(): { ok: boolean; error?: string } | null
  'cache.clearPreviews'(): number
  'cache.rebuildThumbnails'(): number
}

export interface Events {
  'library:changed': LibraryChange
  'library:opened': LibraryInfo | null
  'media:updated': { ids: number[] }
  activity: ActivityStatus
  'import:finished': ImportSummary
  'convert:progress': ConvertProgress
  'transcode:progress': { id: number; progress: number; done: boolean; error?: string; url?: string }
  history: HistoryState & { action?: string; kind?: 'do' | 'undo' | 'redo' }
  'open-paths': string[]
  menu: string
  prefs: Preferences
  toast: { message: string; kind?: 'info' | 'error'; detail?: string }
}

export type ApiMethod = keyof Api
export type ApiArgs<K extends ApiMethod> = Parameters<Api[K]>
export type ApiResult<K extends ApiMethod> = ReturnType<Api[K]>

export interface PreloadBridge {
  invoke<K extends ApiMethod>(method: K, ...args: ApiArgs<K>): Promise<Awaited<ApiResult<K>>>
  on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): () => void
  pathForFile(file: File): string
  platform: string
}
