// User intents, shared by keyboard shortcuts, menus, toolbars and drag & drop.

import {
  Eye, Heart, HeartOff, Tag, FolderPlus, FolderOpen, Copy, RotateCw, RotateCcw, Trash2, Pencil, Images,
  LayoutGrid, Repeat, Info, Play, Star, MoveRight, Presentation, RefreshCw, FolderMinus, ArchiveRestore,
  MapPin, ImagePlus
} from 'lucide-react'
import type { Album, ImportMode, ImportSummary, MediaItem, ViewSpec } from '@shared/types'
import { call, mod, isMac } from './api'
import { fetchItems, invalidateItems } from './items'
import { count, fileName } from './format'
import { useApp } from '../store/app'
import { useGallery, selectedIds, currentView } from '../store/gallery'
import { toast, useUI, type MenuItem } from '../store/ui'
import { ImportDialog } from '../components/dialogs/ImportDialog'
import { AlbumPicker, DeleteDialog, TagDialog } from '../components/dialogs/pickers'
import { ImportSummaryDialog, ShortcutsDialog } from '../components/dialogs/misc'
import { confirmDialog, errorDialog, promptDialog } from '../components/dialogs/common'

const ui = (): ReturnType<typeof useUI.getState> => useUI.getState()

// ─── undo ───────────────────────────────────────────────────────────────────

export async function undo(): Promise<void> {
  const label = await call('history.undo')
  if (label) toast(`Undone: ${label}`, { action: { label: 'Redo', run: () => void redo() } })
}

export async function redo(): Promise<void> {
  const label = await call('history.redo')
  if (label) toast(`Redone: ${label}`)
}

const undoAction = { label: 'Undo', run: () => void undo() }

// ─── import ─────────────────────────────────────────────────────────────────

export async function startImport(paths: string[], opts: { albumId?: number; forced?: boolean } = {}): Promise<void> {
  const app = useApp.getState()
  if (!app.library || !app.prefs || !paths.length) return
  const inLibrary = paths.every((p) => p.startsWith(app.library!.path))
  let mode: ImportMode
  if (inLibrary) mode = 'reference'
  else if (app.prefs.importMode !== 'ask') mode = app.prefs.importMode
  else {
    const albumName = opts.albumId ? app.albums.find((a) => a.id === opts.albumId)?.name : undefined
    const r = await new Promise<{ mode: ImportMode; remember: boolean } | null>((resolve) => {
      ui().openDialog((close) => (
        <ImportDialog
          paths={paths}
          defaultMode="copy"
          albumName={albumName}
          onDone={(v) => {
            close()
            resolve(v)
          }}
        />
      ))
    })
    if (!r) return
    mode = r.mode
    if (r.remember) app.setPrefs({ importMode: r.mode })
  }
  try {
    if (opts.forced) await call('import.startForced', { paths, mode, albumId: opts.albumId })
    else await call('import.start', { paths, mode, albumId: opts.albumId })
  } catch (err) {
    toast('Couldn’t start the import', { kind: 'error', detail: (err as Error).message })
  }
}

export async function importViaPicker(directories: boolean): Promise<void> {
  const paths = await call('app.chooseFiles', { title: directories ? 'Import Folder' : 'Import Photos & Videos', directories, media: true })
  if (paths.length) await startImport(paths)
}

export function onImportFinished(s: ImportSummary): void {
  const issues = s.duplicates.length + s.failed.length
  const details = (): void => {
    ui().openDialog((close) => (
      <ImportSummaryDialog
        summary={s}
        onClose={close}
        onImportAnyway={(paths) => {
          close()
          void call('import.startForced', { paths, mode: s.mode, albumId: s.albumId })
        }}
      />
    ))
  }
  if (s.cancelled) {
    toast(`Import stopped — ${count(s.added, 'item')} added`)
    return
  }
  if (!s.added && !issues) {
    toast(s.alreadyInLibrary ? `Everything was already in your library (${count(s.alreadyInLibrary, 'item')})` : 'No photos or videos were found')
    return
  }
  const parts = [s.added ? `Imported ${count(s.added, 'item')}` : 'Nothing new to import']
  if (s.duplicates.length) parts.push(`${count(s.duplicates.length, 'duplicate')} skipped`)
  if (s.failed.length) parts.push(`${s.failed.length.toLocaleString()} couldn’t be read`)
  toast(parts.join(' · '), {
    kind: s.failed.length && !s.added ? 'error' : s.added ? 'success' : 'info',
    action: issues ? { label: 'Details', run: details } : s.added ? { label: 'Show', run: () => useApp.getState().navigate({ kind: 'view', view: { type: 'import', id: s.jobId } }) } : undefined,
    duration: 8000
  })
}

// ─── flags ──────────────────────────────────────────────────────────────────

export async function toggleFavorite(ids: number[]): Promise<void> {
  if (!ids.length) return
  const items = await fetchItems(ids)
  const all = items.length > 0 && items.every((m) => m.favorite)
  await call('media.setFavorite', ids, !all)
  invalidateItems(ids)
}

export async function setRating(ids: number[], rating: number): Promise<void> {
  if (!ids.length) return
  await call('media.setRating', ids, rating)
  invalidateItems(ids)
}

export async function rotate(ids: number[], delta: number): Promise<void> {
  if (!ids.length) return
  await call('media.rotate', ids, delta)
  invalidateItems(ids)
}

// ─── delete / restore ───────────────────────────────────────────────────────

export async function trash(ids: number[]): Promise<void> {
  if (!ids.length) return
  const n = await call('media.trash', ids)
  if (n) toast(`Moved ${count(n, 'item')} to Recently Deleted`, { action: undoAction })
}

export async function restore(ids: number[]): Promise<void> {
  if (!ids.length) return
  const n = await call('media.restore', ids)
  if (n) toast(`Restored ${count(n, 'item')}`, { action: undoAction })
}

export async function deletePermanently(ids: number[]): Promise<void> {
  if (!ids.length) return
  const items = await fetchItems(ids)
  const copied = items.filter((m) => m.inLibrary).length
  const choice = await new Promise<'library' | 'files' | null>((resolve) => {
    ui().openDialog((close) => (
      <DeleteDialog
        copied={copied}
        referenced={items.length - copied}
        onDone={(c) => {
          close()
          resolve(c)
        }}
      />
    ))
  })
  if (!choice) return
  const r = await call('media.deletePermanently', ids, choice === 'files')
  useGallery.getState().clear()
  if (r.errors.length) toast(`${count(r.errors.length, 'file')} couldn’t be moved to the Trash`, { kind: 'error', detail: r.errors.slice(0, 3).join('\n') })
  else toast(choice === 'files' ? `Moved ${count(r.trashed, 'file')} to the Trash` : `Removed ${count(r.removed, 'item')} from the library`)
}

export async function emptyTrash(): Promise<void> {
  const ids = await call('media.idsForQuery', { view: { type: 'deleted' }, sort: 'date', dir: 'desc' })
  if (ids.length) await deletePermanently(ids)
}

// ─── files ──────────────────────────────────────────────────────────────────

export async function rename(id: number): Promise<void> {
  const [item] = await fetchItems([id])
  if (!item) return
  const i = item.filename.lastIndexOf('.')
  const base = i > 0 ? item.filename.slice(0, i) : item.filename
  const ext = i > 0 ? item.filename.slice(i) : ''
  const name = await promptDialog({
    title: 'Rename',
    message: item.inLibrary ? undefined : 'This renames the original file on disk.',
    initial: base,
    suffix: ext,
    confirmLabel: 'Rename',
    validate: async (v) => {
      const r = await call('media.rename', id, v + ext)
      return r.ok ? null : (r.error ?? 'Couldn’t rename')
    }
  })
  if (name) {
    invalidateItems([id])
    toast(`Renamed to “${name}${ext}”`, { action: undoAction })
  }
}

export async function moveTo(ids: number[]): Promise<void> {
  if (!ids.length) return
  const dir = await call('app.chooseDirectory', { title: `Move ${count(ids.length, 'item')} to…`, buttonLabel: 'Move Here' })
  if (!dir) return
  const r = await call('media.move', ids, dir)
  invalidateItems(ids)
  if (r.errors.length) errorDialog({ title: `${count(r.errors.length, 'file')} couldn’t be moved`, message: 'The rest were moved successfully.', details: r.errors.join('\n') })
  if (r.moved) toast(`Moved ${count(r.moved, 'file')} to ${fileName(dir)}`, { action: undoAction })
}

export async function showInFolder(id: number): Promise<void> {
  const [item] = await fetchItems([id])
  if (item) await call('app.showItemInFolder', item.path)
}

export async function copyPaths(ids: number[]): Promise<void> {
  const paths = await call('media.paths', ids)
  await call('app.copyText', paths.join('\n'))
  toast(ids.length === 1 ? 'Path copied' : `${count(ids.length, 'path')} copied`)
}

// ─── albums & tags ──────────────────────────────────────────────────────────

export async function addToAlbum(albumId: number, ids: number[]): Promise<void> {
  const album = useApp.getState().albums.find((a) => a.id === albumId)
  const n = await call('albums.addItems', albumId, ids)
  if (n) toast(`Added ${count(n, 'item')} to “${album?.name ?? 'album'}”`, { action: undoAction })
  else toast(`Already in “${album?.name ?? 'album'}”`)
}

export async function newAlbum(ids: number[] = [], suggested = ''): Promise<Album | null> {
  const name = await promptDialog({ title: 'New Album', initial: suggested, placeholder: 'Album name', confirmLabel: 'Create' })
  if (!name) return null
  const album = await call('albums.create', name, ids)
  await useApp.getState().refreshStructure()
  if (ids.length) {
    toast(`Created “${album.name}” with ${count(ids.length, 'item')}`, {
      action: { label: 'Show', run: () => useApp.getState().navigate({ kind: 'view', view: { type: 'album', id: album.id } }) }
    })
  } else useApp.getState().navigate({ kind: 'view', view: { type: 'album', id: album.id } })
  return album
}

export function albumPicker(ids: number[]): void {
  if (!ids.length) return
  ui().openDialog((close) => (
    <AlbumPicker
      ids={ids}
      onClose={close}
      onPick={async (id, name) => {
        close()
        if (id === 'new') {
          const album = await call('albums.create', name ?? 'Untitled Album', ids)
          toast(`Created “${album.name}” with ${count(ids.length, 'item')}`, {
            action: { label: 'Show', run: () => useApp.getState().navigate({ kind: 'view', view: { type: 'album', id: album.id } }) }
          })
        } else await addToAlbum(id, ids)
      }}
    />
  ))
}

export function tagDialog(ids: number[]): void {
  if (!ids.length) return
  ui().openDialog((close) => <TagDialog ids={ids} onClose={close} />)
}

export async function removeFromAlbum(albumId: number, ids: number[]): Promise<void> {
  const n = await call('albums.removeItems', albumId, ids)
  if (n) toast(`Removed ${count(n, 'item')} from the album`, { action: undoAction })
}

export async function renameAlbum(album: Album): Promise<void> {
  const name = await promptDialog({ title: 'Rename Album', initial: album.name, confirmLabel: 'Rename' })
  if (name && name !== album.name) await call('albums.rename', album.id, name)
}

export async function deleteAlbum(album: Album): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete “${album.name}”?`,
    message: 'The album is removed. The photos and videos in it stay in your library.',
    confirmLabel: 'Delete Album',
    danger: true
  })
  if (!ok) return
  await call('albums.delete', album.id)
  const r = useApp.getState().route
  if (r.kind === 'view' && r.view.type === 'album' && r.view.id === album.id) useApp.getState().navigate({ kind: 'view', view: { type: 'all' } })
  toast(`Deleted “${album.name}”`, { action: undoAction })
}

export async function renameTag(tag: { id: number; name: string }): Promise<void> {
  const name = await promptDialog({
    title: 'Rename Tag',
    message: 'If another tag already has this name, the two are merged.',
    initial: tag.name,
    confirmLabel: 'Rename',
    validate: async (v) => {
      const r = await call('tags.rename', tag.id, v)
      return r.ok ? null : (r.error ?? 'Couldn’t rename')
    }
  })
  if (name) toast(`Renamed tag to “${name}”`, { action: undoAction })
}

export async function deleteTag(tag: { id: number; name: string; count: number }): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete tag “${tag.name}”?`,
    message: `It’s removed from ${count(tag.count, 'item')}. The items themselves are not affected.`,
    confirmLabel: 'Delete Tag',
    danger: true
  })
  if (!ok) return
  await call('tags.delete', tag.id)
  const r = useApp.getState().route
  if (r.kind === 'view' && r.view.type === 'tag' && r.view.id === tag.id) useApp.getState().navigate({ kind: 'view', view: { type: 'all' } })
  toast(`Deleted tag “${tag.name}”`, { action: undoAction })
}

// ─── navigation to tools ────────────────────────────────────────────────────

export async function openConverter(ids: number[]): Promise<void> {
  const items = ids.length ? await call('convert.fromMedia', ids) : []
  useUI.setState({ converterItems: items })
  useApp.getState().navigate({ kind: 'converter' })
  if (ids.length && !items.length) toast('Only photos can be converted')
}

export function openCollage(ids: number[]): void {
  useUI.setState({ collageIds: ids })
  useApp.getState().navigate({ kind: 'collage' })
}

export function showShortcuts(): void {
  ui().openDialog((close) => <ShortcutsDialog onClose={close} />)
}

// ─── viewer ─────────────────────────────────────────────────────────────────

export function openViewerAt(id: number, origin?: DOMRect | null, slideshow = false): void {
  const g = useGallery.getState()
  if (!g.layout) return
  const index = g.indexOf.get(id) ?? 0
  ui().openViewer(Array.from(g.layout.ids), index, origin ?? null, slideshow)
}

export function openSelectionInViewer(slideshow = false): void {
  const ids = selectedIds()
  const g = useGallery.getState()
  if (!g.layout || !g.layout.ids.length) return
  if (ids.length > 1) {
    // Browse just the selection.
    ui().openViewer(ids, 0, null, slideshow)
    return
  }
  const id = ids[0] ?? g.layout.ids[0]
  openViewerAt(id, document.querySelector<HTMLElement>(`[data-media-id="${id}"] [data-frame]`)?.getBoundingClientRect() ?? null, slideshow)
}

// ─── context menus ──────────────────────────────────────────────────────────

function albumSubmenu(ids: number[]): MenuItem[] {
  const albums = useApp.getState().albums
  return [
    { label: 'New Album…', icon: FolderPlus, onSelect: () => void newAlbum(ids) },
    ...(albums.length ? [{ separator: true } as MenuItem] : []),
    ...albums.slice(0, 20).map<MenuItem>((a) => ({ label: a.name, icon: Images, onSelect: () => void addToAlbum(a.id, ids) })),
    ...(albums.length > 20 ? [{ label: 'More Albums…', onSelect: () => albumPicker(ids) }] : [])
  ]
}

function ratingSubmenu(ids: number[], current?: number): MenuItem[] {
  return [0, 1, 2, 3, 4, 5].map((r) => ({
    label: r === 0 ? 'No Rating' : '★'.repeat(r),
    checked: current === r,
    shortcut: String(r),
    onSelect: () => void setRating(ids, r)
  }))
}

export async function mediaContextMenu(x: number, y: number): Promise<void> {
  const ids = selectedIds()
  if (!ids.length) return
  const items = await fetchItems(ids.slice(0, 500))
  const single = ids.length === 1 ? items[0] : undefined
  const view = currentView()
  const inDeleted = view?.type === 'deleted'
  const allFav = items.length > 0 && items.every((m) => m.favorite)
  const photos = items.filter((m) => m.kind === 'photo').length
  const menu: MenuItem[] = []

  if (inDeleted) {
    menu.push(
      { label: ids.length === 1 ? 'Restore' : `Restore ${count(ids.length, 'Item')}`, icon: ArchiveRestore, onSelect: () => void restore(ids) },
      { separator: true },
      { label: 'Delete Permanently…', icon: Trash2, danger: true, onSelect: () => void deletePermanently(ids) }
    )
    ui().showMenu(x, y, menu)
    return
  }

  if (single) {
    menu.push({ label: single.kind === 'video' ? 'Play' : 'Open in Viewer', icon: single.kind === 'video' ? Play : Eye, shortcut: 'Space', onSelect: () => openViewerAt(single.id) })
  } else {
    menu.push({ label: `View ${count(ids.length, 'Item')}`, icon: Eye, onSelect: () => ui().openViewer(ids, 0) })
    menu.push({ label: 'Slideshow', icon: Presentation, onSelect: () => ui().openViewer(ids, 0, null, true) })
  }
  menu.push(
    { separator: true },
    { label: 'Add to Album', icon: Images, submenu: albumSubmenu(ids) },
    { label: 'Add Tag…', icon: Tag, shortcut: 'T', onSelect: () => tagDialog(ids) },
    { label: allFav ? 'Unfavorite' : 'Favorite', icon: allFav ? HeartOff : Heart, shortcut: 'F', onSelect: () => void toggleFavorite(ids) },
    { label: 'Rating', icon: Star, submenu: ratingSubmenu(ids, single?.rating) }
  )
  if (view?.type === 'album') {
    const albumId = view.id
    menu.push({ label: 'Remove from Album', icon: FolderMinus, onSelect: () => void removeFromAlbum(albumId, ids) })
    if (single) menu.push({ label: 'Use as Album Cover', icon: ImagePlus, onSelect: () => void call('albums.setCover', albumId, single.id) })
  }
  menu.push({ separator: true })
  if (single) menu.push({ label: 'Rename…', icon: Pencil, onSelect: () => void rename(single.id) })
  menu.push(
    { label: 'Rotate Clockwise', icon: RotateCw, shortcut: 'R', onSelect: () => void rotate(ids, 90) },
    { label: 'Rotate Counterclockwise', icon: RotateCcw, shortcut: '⇧R', onSelect: () => void rotate(ids, -90) }
  )
  if (photos > 0) {
    menu.push(
      { label: photos === 1 ? 'Convert…' : `Convert ${count(photos, 'Photo')}…`, icon: Repeat, onSelect: () => void openConverter(ids) },
      { label: 'Create Collage', icon: LayoutGrid, disabled: photos < 1, onSelect: () => openCollage(items.filter((m) => m.kind === 'photo').map((m) => m.id)) }
    )
  }
  menu.push({ separator: true })
  if (single) menu.push({ label: isMac ? 'Show in Finder' : 'Show in Folder', icon: FolderOpen, shortcut: `${mod}⇧R`, onSelect: () => void showInFolder(single.id) })
  menu.push(
    { label: ids.length === 1 ? 'Copy Path' : 'Copy Paths', icon: Copy, onSelect: () => void copyPaths(ids) },
    { label: 'Move to…', icon: MoveRight, onSelect: () => void moveTo(ids) }
  )
  if (single?.error || single?.thumbState === 2) menu.push({ label: 'Retry Thumbnail', icon: RefreshCw, onSelect: () => void call('media.regenerateThumbs', [single.id]) })
  menu.push(
    { separator: true },
    { label: ids.length === 1 ? 'Move to Recently Deleted' : `Move ${count(ids.length, 'Item')} to Recently Deleted`, icon: Trash2, shortcut: 'Del', danger: true, onSelect: () => void trash(ids) }
  )
  if (single) menu.push({ separator: true }, { label: 'Properties', icon: Info, shortcut: `${mod}I`, onSelect: () => useUI.setState({ infoPanel: true }) })
  ui().showMenu(x, y, menu)
}

export function folderContextMenu(folderIds: number[], x: number, y: number): void {
  const app = useApp.getState()
  const folders = app.folders.filter((f) => folderIds.includes(f.id))
  if (!folders.length) return
  const single = folders.length === 1 ? folders[0] : undefined
  const view: ViewSpec = { type: 'folder', ids: folderIds, recursive: true }
  const menu: MenuItem[] = [
    { label: single ? 'Open' : `Show ${folders.length} Folders`, icon: Eye, onSelect: () => app.navigate({ kind: 'view', view }) },
    {
      label: 'Slideshow', icon: Presentation, onSelect: async () => {
        const ids = await call('media.idsForQuery', { view, sort: 'date', dir: 'asc' })
        if (ids.length) ui().openViewer(ids, 0, null, true)
      }
    },
    { separator: true },
    { label: single ? 'Create Album from Folder' : 'Create Album from Folders', icon: FolderPlus, onSelect: async () => {
      const album = await call('folders.createAlbum', folderIds)
      toast(`Created “${album.name}” with ${count(album.count, 'item')}`, { action: { label: 'Show', run: () => app.navigate({ kind: 'view', view: { type: 'album', id: album.id } }) } })
    } },
    { label: 'Convert Images…', icon: Repeat, onSelect: async () => {
      const ids = await call('media.idsForQuery', { view, sort: 'date', dir: 'asc' })
      await openConverter(ids)
    } },
    { separator: true }
  ]
  if (single) {
    menu.push({ label: isMac ? 'Show in Finder' : 'Show in File Manager', icon: FolderOpen, onSelect: () => void call('app.openPath', single.path) })
    menu.push({ label: 'Copy Path', icon: Copy, onSelect: () => { void call('app.copyText', single.path); toast('Path copied') } })
  }
  const referenced = folders.filter((f) => !f.inLibrary)
  if (referenced.length) {
    menu.push({ label: referenced.length > 1 ? 'Check Folders for New Files' : 'Check for New Files', icon: RefreshCw, onSelect: () => { void call('folders.rescan', referenced.map((f) => f.id)); toast('Checking for new files…') } })
  }
  if (single && !single.inLibrary && single.isRoot) {
    menu.push({ label: single.offline ? 'Locate Folder…' : 'Relocate Folder…', icon: MapPin, onSelect: () => void relocateFolder(single.id, single.name) })
  }
  menu.push(
    { separator: true },
    { label: single ? 'Remove from Library…' : `Remove ${folders.length} Folders from Library…`, icon: FolderMinus, danger: true, onSelect: () => void removeFolders(folderIds) }
  )
  ui().showMenu(x, y, menu)
}

async function relocateFolder(id: number, name: string): Promise<void> {
  const dir = await call('app.chooseDirectory', { title: `Locate “${name}”`, buttonLabel: 'Use This Folder' })
  if (!dir) return
  const r = await call('folders.relocate', id, dir)
  if (!r.ok) errorDialog({ title: 'Couldn’t relocate the folder', message: r.error ?? '' })
  else {
    invalidateItems()
    toast(`Updated ${count(r.found ?? 0, 'item')}`)
  }
}

export async function removeFolders(folderIds: number[]): Promise<void> {
  const app = useApp.getState()
  const folders = app.folders.filter((f) => folderIds.includes(f.id))
  const inLib = folders.some((f) => f.inLibrary)
  const ok = await confirmDialog({
    title: folders.length === 1 ? `Remove “${folders[0].name}” from your library?` : `Remove ${folders.length} folders from your library?`,
    message: inLib
      ? 'The items are removed from Loupe, along with their tags and album membership. The files stay in your library’s Originals folder.'
      : 'The items are removed from Loupe, along with their tags and album membership. The files stay on your disk untouched.',
    confirmLabel: 'Remove',
    danger: true
  })
  if (!ok) return
  const n = await call('folders.remove', folderIds)
  const r = app.route
  if (r.kind === 'view' && r.view.type === 'folder') app.navigate({ kind: 'view', view: { type: 'all' } })
  toast(`Removed ${count(n, 'item')} from the library`, { action: undoAction })
}

export function albumContextMenu(album: Album, x: number, y: number): void {
  const app = useApp.getState()
  ui().showMenu(x, y, [
    { label: 'Open', icon: Eye, onSelect: () => app.navigate({ kind: 'view', view: { type: 'album', id: album.id } }) },
    {
      label: 'Slideshow', icon: Presentation, disabled: !album.count, onSelect: async () => {
        const ids = await call('media.idsForQuery', { view: { type: 'album', id: album.id }, sort: 'manual', dir: 'asc' })
        if (ids.length) ui().openViewer(ids, 0, null, true)
      }
    },
    {
      label: 'Create Collage', icon: LayoutGrid, disabled: !album.count, onSelect: async () => {
        const ids = await call('media.idsForQuery', { view: { type: 'album', id: album.id }, sort: 'manual', dir: 'asc' })
        const items = await fetchItems(ids.slice(0, 60))
        openCollage(items.filter((m) => m.kind === 'photo').map((m) => m.id))
      }
    },
    { separator: true },
    { label: 'Rename…', icon: Pencil, onSelect: () => void renameAlbum(album) },
    { separator: true },
    { label: 'Delete Album…', icon: Trash2, danger: true, onSelect: () => void deleteAlbum(album) }
  ])
}

export function tagContextMenu(tag: { id: number; name: string; count: number }, x: number, y: number): void {
  const app = useApp.getState()
  ui().showMenu(x, y, [
    { label: 'Show Items', icon: Eye, onSelect: () => app.navigate({ kind: 'view', view: { type: 'tag', id: tag.id } }) },
    { label: 'Rename…', icon: Pencil, onSelect: () => void renameTag(tag) },
    { separator: true },
    { label: 'Delete Tag…', icon: Trash2, danger: true, onSelect: () => void deleteTag(tag) }
  ])
}

export async function openLibraryDialog(): Promise<void> {
  const dir = await call('app.chooseDirectory', { title: 'Open Library', buttonLabel: 'Open Library' })
  if (!dir) return
  const r = await call('library.open', dir)
  if (!r.ok) errorDialog({ title: 'Couldn’t open this library', message: r.error ?? 'Unknown error' })
}

export async function newLibraryDialog(): Promise<void> {
  const parent = await call('app.chooseDirectory', { title: 'Choose where to create the new library', defaultPath: await call('library.defaultLocation'), buttonLabel: 'Choose' })
  if (!parent) return
  const name = await promptDialog({ title: 'Name your library', initial: 'Loupe Library', confirmLabel: 'Create Library' })
  if (!name) return
  const r = await call('library.create', parent, name)
  if (!r.ok) errorDialog({ title: 'Couldn’t create the library', message: r.error ?? 'Unknown error' })
  else useApp.setState({ justCreated: true })
}

export function explainItemError(item: MediaItem): void {
  errorDialog({
    title: item.kind === 'video' ? 'This video could not be opened' : 'This image could not be opened',
    message: item.missing
      ? 'The file isn’t available. It may have been moved or deleted, or it’s on a drive that isn’t connected.'
      : `${item.error ?? 'The file may be damaged or use an unsupported format.'}`,
    path: item.path,
    details: `${item.path}\n${item.error ?? ''}`
  })
}

