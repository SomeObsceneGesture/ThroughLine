// Types shared by the main process, preload and renderer.

export type MediaKind = 'photo' | 'video'

export type ViewSpec =
  | { type: 'all' }
  | { type: 'photos' }
  | { type: 'videos' }
  | { type: 'favorites' }
  | { type: 'recent-added' }
  | { type: 'recent-viewed' }
  | { type: 'timeline' }
  | { type: 'album'; id: number }
  | { type: 'tag'; id: number }
  | { type: 'folder'; ids: number[]; recursive: boolean }
  | { type: 'import'; id: number }
  | { type: 'deleted' }

export type SortKey = 'date' | 'added' | 'name' | 'size' | 'rating' | 'type' | 'manual' | 'viewed'
export type SortDir = 'asc' | 'desc'

export interface MediaQuery {
  view: ViewSpec
  search?: string
  sort: SortKey
  dir: SortDir
}

/** Bit flags packed per item in LayoutResult.flags. Rotation lives in bits 5-6. */
export const FLAG_THUMB = 1
export const FLAG_VIDEO = 2
export const FLAG_FAVORITE = 4
export const FLAG_THUMB_FAILED = 8
export const FLAG_MISSING = 16
export const rotationFromFlags = (f: number): number => ((f >> 5) & 3) * 90

/**
 * Compact, transferable description of every item in a view. It holds only what
 * layout needs (ids, aspect ratios, dates, flags); details are fetched lazily
 * for the visible range.
 */
export interface LayoutResult {
  ids: Int32Array
  ratios: Float32Array
  dates: Float64Array
  flags: Uint8Array
  total: number
  queryMs: number
}

export interface MediaItem {
  id: number
  kind: MediaKind
  filename: string
  ext: string
  path: string
  inLibrary: boolean
  folderId: number | null
  size: number
  mtime: number
  takenAt: number | null
  sortDate: number
  addedAt: number
  width: number | null
  height: number | null
  duration: number | null
  rotation: number
  favorite: boolean
  rating: number
  thumbState: number
  thumbVersion: number
  missing: boolean
  lastViewedAt: number | null
  deletedAt: number | null
  error: string | null
  tags: string[]
  folderName: string | null
}

export interface MediaMetadata {
  format?: string
  make?: string
  model?: string
  lens?: string
  iso?: number
  fNumber?: number
  exposureTime?: number
  focalLength?: number
  focalLength35?: number
  flash?: string
  software?: string
  colorSpace?: string
  gps?: { lat: number; lon: number; alt?: number }
  codec?: string
  audioCodec?: string
  fps?: number
  bitrate?: number
  container?: string
  hasAudio?: boolean
  pages?: number
  bitDepth?: number
  hasAlpha?: boolean
}

export interface MediaDetails extends MediaItem {
  metadata: MediaMetadata
  albums: { id: number; name: string }[]
  tagList: { id: number; name: string }[]
  folderPath: string | null
  duplicateOf?: number[]
}

export interface Album {
  id: number
  name: string
  count: number
  coverId: number | null
  createdAt: number
  updatedAt: number
}

export interface Tag {
  id: number
  name: string
  count: number
}

export interface FolderNode {
  id: number
  parentId: number | null
  name: string
  path: string
  count: number
  isRoot: boolean
  inLibrary: boolean
  offline: boolean
}

export interface LibraryCounts {
  all: number
  photos: number
  videos: number
  favorites: number
  deleted: number
  recentAdded: number
  recentViewed: number
}

export interface LibraryInfo {
  path: string
  name: string
  id: string
  createdAt: number
  counts: LibraryCounts
}

export interface LibraryStats {
  photos: number
  videos: number
  originalsBytes: number
  referencedBytes: number
  copiedCount: number
  referencedCount: number
  thumbnailsBytes: number
  previewsBytes: number
  cacheBytes: number
  databaseBytes: number
  lastImport: number | null
}

export type ActivityPhase = 'idle' | 'scanning' | 'importing' | 'processing'

export interface ActivityStatus {
  import: null | {
    jobId: number
    phase: 'scanning' | 'importing'
    found: number
    processed: number
    added: number
    skipped: number
    failed: number
    queued: number
    currentPath?: string
  }
  processing: {
    done: number
    total: number
    paused: boolean
    failed: number
  }
  task: null | { label: string; done: number; total: number }
}

export type ImportMode = 'copy' | 'reference'

export interface ImportRequest {
  paths: string[]
  mode: ImportMode
  albumId?: number
}

export interface ImportIssue {
  path: string
  reason: string
  existingId?: number
}

export interface ImportSummary {
  jobId: number
  added: number
  alreadyInLibrary: number
  duplicates: ImportIssue[]
  failed: ImportIssue[]
  cancelled: boolean
  mode: ImportMode
  durationMs: number
  albumId?: number
}

export interface ScanPreview {
  files: number
  photos: number
  videos: number
  folders: number
  bytes: number
  unsupported: number
  truncated: boolean
  inLibrary: boolean
}

export type LayoutMode = 'grid' | 'masonry' | 'large' | 'filmstrip' | 'timeline' | 'list'
export type Density = 'compact' | 'comfortable' | 'spacious'

export interface InfoFields {
  filename: boolean
  date: boolean
  type: boolean
  resolution: boolean
  size: boolean
  duration: boolean
  folder: boolean
  rating: boolean
  tags: boolean
}

export interface ViewerPrefs {
  defaultZoom: 'fit' | 'fill' | 'actual'
  background: 'black' | 'dark' | 'theme'
  slideshowSeconds: number
  slideshowTransition: 'fade' | 'none'
  autoplayVideo: boolean
  loopVideo: boolean
  showFilmstrip: boolean
}

export interface MetadataPrefs {
  preferExifDate: boolean
  preserveOnConvert: boolean
  stripLocationOnExport: boolean
  copyNaming: 'original' | 'date'
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
  fullscreen: boolean
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark'
  accent: string
  layout: LayoutMode
  thumbSize: number
  density: Density
  squareThumbs: boolean
  info: InfoFields
  sidebarWidth: number
  sidebarCollapsed: boolean
  infoPanelOpen: boolean
  sort: SortKey
  sortDir: SortDir
  importMode: 'ask' | ImportMode
  copyOrganization: 'structure' | 'date'
  duplicateHandling: 'skip' | 'import'
  rescanOnLaunch: boolean
  workerThreads: number
  hardwareAcceleration: boolean
  thumbnailQuality: 'standard' | 'high'
  previewCacheMB: number
  viewer: ViewerPrefs
  metadata: MetadataPrefs
  recentLibraries: string[]
  lastLibrary: string | null
  window: WindowState
  sidebarSections: Record<string, boolean>
  converter: ConvertOptions
  collapsedFolders: number[]
}

export type ConvertFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff'

export interface ConvertOptions {
  format: ConvertFormat
  quality: number
  resize: 'original' | 'long' | 'width' | 'height' | 'percent'
  resizeValue: number
  naming: string
  destination: 'same' | 'subfolder' | 'custom'
  customDir: string | null
  subfolderName: string
  keepMetadata: boolean
  stripLocation: boolean
  addToLibrary: boolean
}

export interface ConvertJobItem {
  path: string
  mediaId?: number
}

export interface ConvertProgress {
  jobId: number
  done: number
  total: number
  failed: number
  current?: string
  finished: boolean
  cancelled: boolean
  outputs: string[]
  errors: { path: string; reason: string }[]
  outputBytes: number
  inputBytes: number
}

export interface DuplicateGroup {
  key: string
  kind: 'exact' | 'similar'
  items: MediaItem[]
  suggestedKeep: number
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  scanned: number
  durationMs: number
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export interface Storyboard {
  url: string
  cols: number
  rows: number
  count: number
  interval: number
  tileWidth: number
  tileHeight: number
}

export interface PlayableInfo {
  status: 'direct' | 'ready' | 'converting' | 'unavailable'
  url?: string
  codec?: string
  reason?: string
}

export interface SearchSuggestion {
  kind: 'tag' | 'album' | 'folder' | 'year' | 'month' | 'type' | 'camera'
  label: string
  detail?: string
  token: string
  id?: number
  count?: number
}

export interface ExternalFile {
  path: string
  name: string
  kind: MediaKind
  url: string
  size: number
  mediaId?: number
}

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  electron: string
  userData: string
  ffmpeg: boolean
}

export type LibraryChange =
  | { type: 'reset' }
  | { type: 'items'; ids: number[] }
  | { type: 'structure' }

export interface LibraryOpenResult {
  ok: boolean
  info?: LibraryInfo
  error?: string
  missing?: boolean
}
