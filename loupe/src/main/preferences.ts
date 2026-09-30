// App-level preferences, stored as JSON in the OS user-data directory
// (separate from any library, so they survive switching libraries).

import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Preferences } from '@shared/types'

export const DEFAULT_PREFS: Preferences = {
  theme: 'system',
  accent: 'blue',
  layout: 'grid',
  thumbSize: 190,
  density: 'comfortable',
  squareThumbs: true,
  info: {
    filename: false,
    date: false,
    type: false,
    resolution: false,
    size: false,
    duration: true,
    folder: false,
    rating: true,
    tags: false
  },
  sidebarWidth: 232,
  sidebarCollapsed: false,
  infoPanelOpen: false,
  sort: 'date',
  sortDir: 'desc',
  importMode: 'ask',
  copyOrganization: 'structure',
  duplicateHandling: 'skip',
  rescanOnLaunch: false,
  workerThreads: 0,
  hardwareAcceleration: true,
  thumbnailQuality: 'standard',
  previewCacheMB: 2048,
  viewer: {
    defaultZoom: 'fit',
    background: 'black',
    slideshowSeconds: 4,
    slideshowTransition: 'fade',
    autoplayVideo: true,
    loopVideo: false,
    showFilmstrip: true
  },
  metadata: {
    preferExifDate: true,
    preserveOnConvert: true,
    stripLocationOnExport: false,
    copyNaming: 'original'
  },
  recentLibraries: [],
  lastLibrary: null,
  window: { width: 1360, height: 860, maximized: false, fullscreen: false },
  sidebarSections: { library: true, organize: true, albums: true, tags: true, folders: true, tools: true },
  converter: {
    format: 'jpeg',
    quality: 90,
    resize: 'original',
    resizeValue: 2048,
    naming: '{name}',
    destination: 'subfolder',
    customDir: null,
    subfolderName: 'Converted',
    keepMetadata: true,
    stripLocation: false,
    addToLibrary: false
  },
  collapsedFolders: []
}

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k]
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = merge(b, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

class PreferenceStore {
  private data: Preferences = DEFAULT_PREFS
  private file = ''
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<(p: Preferences) => void>()

  load(): Preferences {
    this.file = join(app.getPath('userData'), 'preferences.json')
    try {
      this.data = merge(DEFAULT_PREFS, JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      this.data = DEFAULT_PREFS
    }
    return this.data
  }

  get(): Preferences {
    return this.data
  }

  set(patch: Partial<Preferences>): Preferences {
    this.data = merge(this.data, patch)
    // Arrays and nested objects in the patch replace wholesale where given.
    for (const [k, v] of Object.entries(patch)) {
      if (Array.isArray(v)) (this.data as unknown as Record<string, unknown>)[k] = v
    }
    this.scheduleSave()
    for (const l of this.listeners) l(this.data)
    return this.data
  }

  onChange(fn: (p: Preferences) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('Failed to save preferences', err)
    }
  }
}

export const prefs = new PreferenceStore()
