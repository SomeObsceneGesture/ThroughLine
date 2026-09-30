import { useEffect, useMemo, useState } from 'react'
import { Heart, Images, Tag, LayoutGrid, Repeat, Trash2, X, ArchiveRestore, Download } from 'lucide-react'
import { useApp, isDark } from './store/app'
import { useGallery, selectedIds } from './store/gallery'
import { useUI, toast } from './store/ui'
import { call, on } from './lib/api'
import { invalidateItems } from './lib/items'
import { isFileDrag, droppedPaths } from './lib/dnd'
import { count } from './lib/format'
import { accentColor } from './lib/theme'
import * as actions from './lib/actions'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { Gallery } from './components/gallery/Gallery'
import { InfoPanel } from './components/InfoPanel'
import { Viewer } from './components/viewer/Viewer'
import { ContextMenuHost, DialogHost, ToastHost } from './components/ui/overlays'
import { Welcome } from './views/Welcome'
import { SettingsView } from './views/Settings'
import { ConverterView } from './views/Converter'
import { CollageStudio } from './views/collage/CollageStudio'
import { DuplicatesView } from './views/Duplicates'
import { Button } from './components/ui/controls'
import { cx } from './lib/cx'

function useTheme(): void {
  const prefs = useApp((s) => s.prefs)
  const systemDark = useApp((s) => s.systemDark)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const f = (): void => useApp.setState({ systemDark: mq.matches })
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  useEffect(() => {
    if (!prefs) return
    const dark = isDark()
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.setProperty('--accent', accentColor(prefs.accent, dark))
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || (dark ? '#141416' : '#fbfbfc')
    void call('app.setTitleBarTheme', { color: bg, symbolColor: dark ? '#e8e8ea' : '#1b1b1f' })
  }, [prefs?.theme, prefs?.accent, systemDark]) // eslint-disable-line react-hooks/exhaustive-deps
}

async function openPaths(paths: string[]): Promise<void> {
  if (!paths.length) return
  const { library } = useApp.getState()
  const r = await call('external.open', paths)
  const folders = paths.filter((p) => !r.files.some((f) => f.path === p))
  // Media files open straight in the viewer (like a system photo viewer);
  // folders dropped on the app icon go to import.
  if (r.files.length) {
    const inLib = r.files[r.startIndex]?.mediaId
    if (inLib && library && paths.length === 1) {
      useUI.getState().openViewer([inLib], 0)
    } else useUI.getState().openExternal(r.files, r.startIndex)
  }
  if (folders.length && library) await actions.startImport(folders)
}

function useBootstrap(): void {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [prefs, info, launch, library] = await Promise.all([
        call('app.getPrefs'),
        call('app.info'),
        call('library.launchState'),
        call('library.current')
      ])
      if (cancelled) return
      useApp.setState({ prefs, info, launch, library, phase: library ? 'library' : 'welcome', counts: library?.counts ?? useApp.getState().counts })
      if (library) {
        await useApp.getState().refreshStructure()
        void useGallery.getState().reload()
      }
      useApp.setState({ activity: await call('activity.status'), history: await call('history.state') })
      const paths = await call('app.consumeLaunchPaths')
      if (paths.length) void openPaths(paths)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let structureTimer: number | null = null
    let layoutTimer: number | null = null
    const scheduleLayout = (ms: number): void => {
      if (layoutTimer) return
      layoutTimer = window.setTimeout(() => {
        layoutTimer = null
        void useGallery.getState().reload()
      }, ms)
    }
    const scheduleStructure = (): void => {
      if (structureTimer) return
      structureTimer = window.setTimeout(() => {
        structureTimer = null
        void useApp.getState().refreshStructure()
      }, 250)
    }
    const offs = [
      on('library:opened', (info) => {
        useApp.setState({ library: info, phase: info ? 'library' : 'welcome', route: { kind: 'view', view: { type: 'all' } }, back: [] })
        useGallery.setState({ selection: new Set(), focus: null, anchor: null, search: '', layout: null, loadedOnce: false })
        invalidateItems()
        if (info) {
          void useApp.getState().refreshStructure()
          void useGallery.getState().reload()
        }
      }),
      on('library:changed', (c) => {
        if (c.type === 'items') invalidateItems(c.ids)
        if (c.type === 'reset') invalidateItems()
        scheduleStructure()
        scheduleLayout(120)
      }),
      on('media:updated', ({ ids }) => {
        invalidateItems(ids)
        scheduleLayout(1500)
      }),
      on('activity', (a) => useApp.setState({ activity: a })),
      on('history', (h) => useApp.setState({ history: { canUndo: h.canUndo, canRedo: h.canRedo, undoLabel: h.undoLabel, redoLabel: h.redoLabel } })),
      on('import:finished', (s) => actions.onImportFinished(s)),
      on('open-paths', (paths) => void openPaths(paths)),
      on('prefs', (p) => useApp.setState({ prefs: p })),
      on('toast', (t) => toast(t.message, { kind: t.kind ?? 'info', detail: t.detail })),
      on('menu', (cmd) => runCommand(cmd))
    ]
    return () => offs.forEach((f) => f())
  }, [])
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement
  return !!t.closest('input, textarea, select, [contenteditable="true"]')
}

export function runCommand(cmd: string): void {
  const app = useApp.getState()
  const ui = useUI.getState()
  const typing = document.activeElement?.closest('input, textarea, [contenteditable="true"]')
  if (cmd.startsWith('layout:')) {
    app.setPrefs({ layout: cmd.slice(7) as never })
    if (app.route.kind !== 'view') app.navigate({ kind: 'view', view: { type: 'all' } })
    return
  }
  switch (cmd) {
    case 'import': void actions.importViaPicker(false); break
    case 'import-folder': void actions.importViaPicker(true); break
    case 'new-album': void actions.newAlbum(app.route.kind === 'view' ? selectedIds() : []); break
    case 'open-library': void actions.openLibraryDialog(); break
    case 'new-library': void actions.newLibraryDialog(); break
    case 'backup': app.navigate({ kind: 'settings', section: 'backup' }); break
    case 'settings': app.navigate({ kind: 'settings' }); break
    case 'shortcuts': actions.showShortcuts(); break
    case 'about-library': app.navigate({ kind: 'settings', section: 'library' }); break
    case 'collage': app.navigate({ kind: 'collage' }); break
    case 'converter': app.navigate({ kind: 'converter' }); break
    case 'duplicates': app.navigate({ kind: 'duplicates' }); break
    case 'undo':
      if (typing) document.execCommand('undo')
      else if (app.route.kind === 'collage') window.dispatchEvent(new Event('loupe:collage-undo'))
      else void actions.undo()
      break
    case 'redo':
      if (typing) document.execCommand('redo')
      else if (app.route.kind === 'collage') window.dispatchEvent(new Event('loupe:collage-redo'))
      else void actions.redo()
      break
    case 'select-all':
      if (typing) (typing as HTMLInputElement).select?.()
      else if (app.route.kind === 'view') useGallery.getState().selectAll()
      break
    case 'select-none': useGallery.getState().clear(); break
    case 'find':
      if (app.route.kind !== 'view') app.navigate({ kind: 'view', view: { type: 'all' } })
      if (ui.viewer.open) ui.closeViewer()
      setTimeout(() => useUI.getState().focusSearch(), 30)
      break
    case 'zoom-in': app.setPrefs({ thumbSize: Math.min(420, (app.prefs?.thumbSize ?? 190) + 30) }); break
    case 'zoom-out': app.setPrefs({ thumbSize: Math.max(96, (app.prefs?.thumbSize ?? 190) - 30) }); break
    case 'toggle-sidebar': app.setPrefs({ sidebarCollapsed: !app.prefs?.sidebarCollapsed }); break
    case 'toggle-info': useUI.setState({ infoPanel: !ui.infoPanel }); break
    case 'show-in-folder': {
      const ids = selectedIds()
      if (ids[0] !== undefined) void actions.showInFolder(ids[0])
      break
    }
  }
}

/** App-level shortcuts that mirror the native menu. Handling them here (and
 *  calling preventDefault) keeps them working when the menu bar is hidden and
 *  stops the menu from firing a second time. */
function commandFor(e: KeyboardEvent): string | null {
  const mod = isMacPlatform ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !isMacPlatform) return 'redo'
  if (e.shiftKey) {
    if (k === 'o') return 'import-folder'
    if (k === 'r') return 'show-in-folder'
    return null
  }
  const map: Record<string, string> = {
    o: 'import', n: 'new-album', f: 'find', a: 'select-all', d: 'select-none', i: 'toggle-info', '\\': 'toggle-sidebar',
    ',': 'settings', '/': 'shortcuts', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out',
    '1': 'layout:grid', '2': 'layout:masonry', '3': 'layout:large', '4': 'layout:filmstrip', '5': 'layout:timeline', '6': 'layout:list'
  }
  return map[k] ?? null
}

const isMacPlatform = window.loupe?.platform === 'darwin'

function useGlobalKeys(): void {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const ui = useUI.getState()
      const app = useApp.getState()
      const cmd = commandFor(e)
      if (cmd && !ui.dialogs.length) {
        const typing = isTyping(e)
        // Let text fields keep their own undo/select-all/etc.
        if (typing && ['undo', 'redo', 'select-all', 'zoom-in', 'zoom-out'].includes(cmd)) return
        if (ui.viewer.open && !['undo', 'redo', 'find', 'settings'].includes(cmd)) return
        e.preventDefault()
        e.stopPropagation()
        runCommand(cmd)
        return
      }
      if (ui.viewer.open || ui.dialogs.length || ui.menu || isTyping(e)) return
      if (app.phase !== 'library' || app.route.kind !== 'view') return
      const ids = selectedIds()
      const inDeleted = app.route.view.type === 'deleted'
      const k = e.key
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey
      let handled = true
      if ((k === ' ' || k === 'Enter') && plain) actions.openSelectionInViewer()
      else if (k === 'Escape') {
        if (useGallery.getState().selection.size) useGallery.getState().clear()
        else if (useGallery.getState().search) {
          useGallery.getState().setSearch('')
          void useGallery.getState().reload()
        } else handled = false
      } else if ((k === 'Delete' || (k === 'Backspace' && (e.metaKey || plain))) && ids.length) {
        if (inDeleted) void actions.deletePermanently(ids)
        else void actions.trash(ids)
      } else if ((k === 'f' || k === 'F') && plain && ids.length && !inDeleted) void actions.toggleFavorite(ids)
      else if (/^[0-5]$/.test(k) && plain && ids.length && !inDeleted) void actions.setRating(ids, parseInt(k, 10))
      else if ((k === 't' || k === 'T') && plain && ids.length && !inDeleted) actions.tagDialog(ids)
      else if ((k === 'a' || k === 'A') && plain && ids.length && !inDeleted) actions.albumPicker(ids)
      else if ((k === 'r' || k === 'R') && !e.metaKey && !e.ctrlKey && ids.length && !inDeleted) void actions.rotate(ids, e.shiftKey ? -90 : 90)
      else if (k === 'F2' && ids.length === 1) void actions.rename(ids[0])
      else if (/^[a-z0-9#]$/i.test(k) && plain && k.length === 1 && !ids.length && k !== ' ') {
        // Type-to-search.
        useUI.getState().focusSearch()
        handled = false
      } else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
}

/** Full-window drop target for files dragged in from the OS. */
function DropOverlay() {
  const [over, setOver] = useState(false)
  const route = useApp((s) => s.route)
  const albums = useApp((s) => s.albums)
  const library = useApp((s) => s.library)
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overH = (e: DragEvent): void => {
      if (isFileDrag(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      depth = 0
      setOver(false)
      if (!isFileDrag(e)) return
      e.preventDefault()
      const paths = droppedPaths(e)
      if (!paths.length) return
      const app = useApp.getState()
      if (!app.library) return
      if (app.route.kind === 'converter' || app.route.kind === 'collage') return
      const view = app.route.kind === 'view' ? app.route.view : null
      void actions.startImport(paths, { albumId: view?.type === 'album' ? view.id : undefined })
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!over || !library || route.kind === 'converter' || route.kind === 'collage') return null
  const album = route.kind === 'view' && route.view.type === 'album' ? albums.find((a) => a.id === (route.view as { id: number }).id) : null
  return (
    <div className="fixed inset-0 z-[90] pointer-events-none p-3 anim-fade">
      <div className="h-full w-full rounded-2xl border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px] flex items-center justify-center">
        <div className="px-6 py-4 rounded-2xl bg-overlay shadow-pop flex items-center gap-3 anim-pop">
          <Download size={20} className="text-accent" />
          <div>
            <div className="font-semibold text-[14px]">{album ? `Drop to add to “${album.name}”` : 'Drop to add to your library'}</div>
            <div className="text-[12px] text-fg-3">Photos, videos and whole folders — subfolders included</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SelectionBar() {
  const n = useGallery((s) => s.selection.size)
  const route = useApp((s) => s.route)
  const viewerOpen = useUI((s) => s.viewer.open)
  if (n < 2 || viewerOpen || route.kind !== 'view') return null
  const deleted = route.view.type === 'deleted'
  const ids = (): number[] => selectedIds()
  const btn = 'h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[12.5px] font-medium hover:bg-white/12 text-white/90'
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] anim-up">
      <div className="flex items-center gap-0.5 pl-3.5 pr-1.5 py-1.5 rounded-2xl bg-[#1d1d21]/95 backdrop-blur-xl text-white shadow-[0_12px_40px_rgba(0,0,0,.35)] border border-white/10" role="toolbar" aria-label="Selection actions">
        <span className="text-[12.5px] font-semibold mr-2 tabular">{count(n, 'item')}</span>
        {deleted ? (
          <>
            <button className={btn} onClick={() => void actions.restore(ids())}><ArchiveRestore size={15} /> Restore</button>
            <button className={cx(btn, 'text-[#ff8a8e]')} onClick={() => void actions.deletePermanently(ids())}><Trash2 size={15} /> Delete…</button>
          </>
        ) : (
          <>
            <button className={btn} onClick={() => actions.albumPicker(ids())}><Images size={15} /> Album</button>
            <button className={btn} onClick={() => actions.tagDialog(ids())}><Tag size={15} /> Tag</button>
            <button className={btn} onClick={() => void actions.toggleFavorite(ids())}><Heart size={15} /> Favorite</button>
            <button className={btn} onClick={() => void actions.openConverter(ids())}><Repeat size={15} /> Convert</button>
            <button className={btn} onClick={() => actions.openCollage(ids())}><LayoutGrid size={15} /> Collage</button>
            <button className={btn} onClick={() => void actions.trash(ids())}><Trash2 size={15} /> Delete</button>
          </>
        )}
        <div className="w-px h-5 bg-white/15 mx-1" />
        <button aria-label="Clear selection" className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/12 text-white/70" onClick={() => useGallery.getState().clear()}>
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

function RouteView() {
  const route = useApp((s) => s.route)
  const infoPanel = useUI((s) => s.infoPanel)
  const counts = useApp((s) => s.counts)
  // Reload the gallery whenever the view or search changes.
  const viewKeyStr = route.kind === 'view' ? JSON.stringify(route.view) : ''
  useEffect(() => {
    if (route.kind === 'view') {
      useGallery.setState({ selection: new Set(), focus: null, anchor: null })
      void useGallery.getState().reload()
    }
  }, [viewKeyStr]) // eslint-disable-line react-hooks/exhaustive-deps
  if (route.kind === 'settings') return <SettingsView section={route.section} />
  if (route.kind === 'converter') return <ConverterView />
  if (route.kind === 'collage') return <CollageStudio />
  if (route.kind === 'duplicates') return <DuplicatesView />
  return (
    <div className="flex-1 flex min-h-0">
      <Gallery />
      {infoPanel && counts.all > 0 && <InfoPanel />}
      {route.view.type === 'deleted' && counts.deleted > 0 && <TrashBanner />}
    </div>
  )
}

function TrashBanner() {
  return (
    <div className="absolute bottom-5 right-6 z-[70] flex items-center gap-3 px-4 py-2.5 rounded-xl bg-overlay shadow-pop text-[12.5px] anim-up">
      <span className="text-fg-2">Items here stay until you delete them permanently.</span>
      <Button size="sm" variant="danger" icon={Trash2} onClick={() => void actions.emptyTrash()}>Empty…</Button>
    </div>
  )
}

function Shell() {
  const prefs = useApp((s) => s.prefs)
  useGlobalKeys()
  if (!prefs) return null
  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col relative">
        <Toolbar />
        <RouteView />
      </main>
      <SelectionBar />
      <DropOverlay />
    </div>
  )
}

export function App() {
  useBootstrap()
  useTheme()
  const phase = useApp((s) => s.phase)
  const prefs = useApp((s) => s.prefs)
  const content = useMemo(() => {
    if (phase === 'loading' || !prefs) return <div className="h-full drag-region" />
    if (phase === 'welcome') return <Welcome />
    return <Shell />
  }, [phase, prefs])
  return (
    <>
      {content}
      <Viewer />
      <ContextMenuHost />
      <DialogHost />
      <ToastHost />
    </>
  )
}

// Test/automation hooks (only reach what the UI itself can already do).
Object.assign(window, {
  __setPrefs: (p: Parameters<ReturnType<typeof useApp.getState>['setPrefs']>[0]) => useApp.getState().setPrefs(p),
  __openViewer: (ids: number[], index = 0) => useUI.getState().openViewer(ids, index),
  __navigate: (r: Parameters<ReturnType<typeof useApp.getState>['navigate']>[0]) => useApp.getState().navigate(r),
  __startImport: (paths: string[]) => void actions.startImport(paths)
})
Object.assign(window, { __openCollage: (ids: number[]) => actions.openCollage(ids) })
