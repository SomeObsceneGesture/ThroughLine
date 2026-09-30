// Implements the typed Api contract from @shared/api over a single IPC channel.

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Api } from '@shared/api'
import { ctx, lib } from './context'
import { prefs } from './preferences'
import * as repo from './library/media-repo'
import * as ops from './library/operations'
import * as folders from './library/folders'
import { history } from './library/history'
import { closeLibrary, createLibrary, defaultLibraryLocation, ensurePool, libraryInfo, libraryStats, openLibrary } from './library/manager'
import { previewImport } from './import/importer'
import { activityStatus, broadcastActivity } from './import/indexer'
import { suggest } from './library/suggest'
import { cancelTranscode, playable, probeCodec, storyboardFor } from './video/service'
import { cancelConvert, expandPaths, fromMedia, startConvert } from './tools/converter'
import { ignoreGroup, scanDuplicates } from './library/duplicates'
import { createBackup, restoreBackup } from './library/backup'
import { allowExternal, prunePreviews } from './protocol'
import { WorkerPool } from './workers/pool'
import { extOf, kindOfExt, isSupportedPath, needsPreview } from '@shared/formats'
import { consumeLaunchPaths } from './launch'
import { rm } from 'node:fs/promises'
import type { Album, ExternalFile, Tag } from '@shared/types'

// Automated tests can bypass native file dialogs (which can't be scripted).
const TEST_DIALOG_DIR = process.env.LOUPE_TEST_DIALOG_DIR

function win(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

function mediaUrl(id: number): string {
  const r = lib().db.get<{ ext: string; kind: number }>('SELECT ext, kind FROM media WHERE id = ?', id)
  if (!r) return ''
  return r.kind === 1 && needsPreview(r.ext) ? `loupe://preview/${id}` : `loupe://media/${id}`
}

type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>> }

const handlers: Handlers = {
  // ── app ──
  'app.info': () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
    ffmpeg: !!ctx.ffmpegPath
  }),
  'app.getPrefs': () => prefs.get(),
  'app.setPrefs': (patch) => {
    const before = prefs.get().workerThreads
    const next = prefs.set(patch)
    if (patch.workerThreads !== undefined && patch.workerThreads !== before && ctx.pool) {
      ctx.pool.resize(patch.workerThreads || WorkerPool.defaultSize())
    }
    return next
  },
  'app.showItemInFolder': (p) => shell.showItemInFolder(p),
  'app.openPath': (p) => shell.openPath(p),
  'app.copyText': (t) => clipboard.writeText(t),
  'app.chooseDirectory': async ({ title, defaultPath, buttonLabel }) => {
    if (TEST_DIALOG_DIR) return TEST_DIALOG_DIR
    const w = win()
    const opts: Electron.OpenDialogOptions = { title, defaultPath, buttonLabel, properties: ['openDirectory', 'createDirectory'] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  },
  'app.chooseFiles': async ({ title, directories, media }) => {
    const w = win()
    const props: Electron.OpenDialogOptions['properties'] = directories ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    const opts: Electron.OpenDialogOptions = {
      title,
      properties: props,
      filters: media && !directories ? [{ name: 'Photos & Videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'heic', 'heif', 'avif', 'svg', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw', 'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'mts', 'm2ts', '3gp'] }, { name: 'All Files', extensions: ['*'] }] : undefined
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  },
  'app.setTitleBarTheme': ({ color, symbolColor }) => {
    const w = win()
    if (w && process.platform !== 'darwin') {
      try {
        w.setTitleBarOverlay({ color, symbolColor, height: 48 })
      } catch {
        /* not using overlay */
      }
    }
    if (w) w.setBackgroundColor(color)
  },
  'app.relaunch': () => {
    app.relaunch()
    app.exit(0)
  },
  'app.consumeLaunchPaths': () => consumeLaunchPaths(),
  'app.setFullScreen': (v) => win()?.setFullScreen(v),
  'app.isFullScreen': () => win()?.isFullScreen() ?? false,

  // ── library ──
  'library.current': () => libraryInfo(),
  'library.launchState': () => {
    const p = prefs.get()
    return { lastPath: p.lastLibrary, missing: !!p.lastLibrary && !existsSync(p.lastLibrary), recent: p.recentLibraries }
  },
  'library.defaultLocation': () => defaultLibraryLocation(),
  'library.create': (parent, name) => createLibrary(parent, name),
  'library.open': (p) => openLibrary(p),
  'library.counts': () => repo.counts(lib()),
  'library.stats': () => libraryStats(),
  'library.forgetRecent': (p) => {
    prefs.set({ recentLibraries: prefs.get().recentLibraries.filter((r) => r !== p) })
  },

  // ── media ──
  'media.layout': (q) => repo.layout(lib(), q),
  'media.items': (ids) => repo.items(lib(), ids),
  'media.details': (id) => repo.details(lib(), id),
  'media.setFavorite': (ids, v) => ops.setFavorite(ids, v),
  'media.setRating': (ids, r) => ops.setRating(ids, r),
  'media.rotate': (ids, d) => ops.rotate(ids, d),
  'media.trash': (ids) => ops.trash(ids),
  'media.restore': (ids) => ops.restore(ids),
  'media.deletePermanently': (ids, toTrash) => ops.deletePermanently(ids, toTrash),
  'media.rename': (id, name) => ops.renameMedia(id, name),
  'media.move': (ids, dest) => ops.moveMedia(ids, dest),
  'media.markViewed': (id) => {
    lib().db.run('UPDATE media SET last_viewed_at = ? WHERE id = ?', Date.now(), id)
  },
  'media.prioritize': (ids) => ctx.indexer?.prioritize(ids),
  'media.regenerateThumbs': (ids) => ctx.indexer?.regenerate(ids),
  'media.paths': (ids) => repo.items(lib(), ids).map((m) => m.path),
  'media.previewUrl': (id) => `loupe://preview/${id}`,
  'media.fullUrl': (id) => mediaUrl(id),
  'media.findByPath': (p) => {
    const l = lib()
    const s = l.toStored(p)
    return l.db.value<number>('SELECT id FROM media WHERE in_library = ? AND path = ? AND deleted_at IS NULL', s.inLibrary, s.path) ?? null
  },
  'media.idsForQuery': (q) => repo.idsForQuery(lib(), q),

  // ── albums ──
  'albums.list': () =>
    lib()
      .db.all<{ id: number; name: string; count: number; cover: number | null; created_at: number; updated_at: number }>(
        `SELECT a.id, a.name, a.created_at, a.updated_at,
           (SELECT count(*) FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = a.id AND m.deleted_at IS NULL) AS count,
           COALESCE(
             (SELECT a.cover_media_id FROM media m WHERE m.id = a.cover_media_id AND m.deleted_at IS NULL),
             (SELECT ai.media_id FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = a.id AND m.deleted_at IS NULL ORDER BY ai.position LIMIT 1)
           ) AS cover
         FROM albums a ORDER BY a.name COLLATE NOCASE`
      )
      .map<Album>((r) => ({ id: r.id, name: r.name, count: r.count, coverId: r.cover, createdAt: r.created_at, updatedAt: r.updated_at })),
  'albums.create': (name, ids) => ops.createAlbum(name, ids ?? []),
  'albums.rename': (id, name) => ops.renameAlbum(id, name),
  'albums.delete': (id) => ops.deleteAlbum(id),
  'albums.addItems': (id, ids) => ops.addToAlbum(id, ids),
  'albums.removeItems': (id, ids) => ops.removeFromAlbum(id, ids),
  'albums.reorder': (id, ids, before) => ops.reorderAlbum(id, ids, before),
  'albums.setCover': (id, m) => ops.setAlbumCover(id, m),
  'albums.forMedia': (ids) =>
    lib().db.all(
      `SELECT a.id, a.name, count(*) AS count FROM album_items ai JOIN albums a ON a.id = ai.album_id
       WHERE ai.media_id IN (SELECT value FROM json_each(?)) GROUP BY a.id ORDER BY a.name COLLATE NOCASE`,
      JSON.stringify(ids)
    ),

  // ── tags ──
  'tags.list': () =>
    lib().db.all<Tag>(
      `SELECT t.id, t.name, (SELECT count(*) FROM media_tags mt JOIN media m ON m.id = mt.media_id WHERE mt.tag_id = t.id AND m.deleted_at IS NULL) AS count
       FROM tags t ORDER BY t.name COLLATE NOCASE`
    ),
  'tags.add': (ids, names) => ops.addTags(ids, names),
  'tags.remove': (ids, tagIds) => ops.removeTags(ids, tagIds),
  'tags.rename': (id, name) => ops.renameTag(id, name),
  'tags.delete': (id) => ops.deleteTag(id),
  'tags.forMedia': (ids) =>
    lib().db.all(
      `SELECT t.id, t.name, count(*) AS count FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id IN (SELECT value FROM json_each(?)) GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
      JSON.stringify(ids)
    ),

  // ── folders ──
  'folders.tree': () => folders.tree(lib()),
  'folders.rescan': (ids) => {
    const paths = ids.map((id) => folders.folderAbsPath(lib(), id)).filter((p): p is string => !!p && existsSync(p))
    const l = lib()
    // Flag files that disappeared since the last scan.
    const media = folders.mediaInFolders(l, ids)
    const rows = l.db.all<{ id: number; path: string; in_library: number }>('SELECT id, path, in_library FROM media WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(media))
    l.db.tx(() => {
      for (const r of rows) l.db.run('UPDATE media SET missing = ? WHERE id = ?', existsSync(l.resolve(r.path, r.in_library)) ? 0 : 1, r.id)
    })
    ctx.changes.items(media)
    if (paths.length) ctx.importer?.start({ paths, mode: 'reference' })
  },
  'folders.remove': (ids) => ops.removeFolders(ids),
  'folders.relocate': (id, newPath) => {
    try {
      const r = folders.relocate(lib(), id, newPath)
      ctx.changes.structure()
      ctx.changes.items([])
      return { ok: true, found: r.changed }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },
  'folders.createAlbum': (ids) => {
    const l = lib()
    const name = l.db.value<string>('SELECT name FROM folders WHERE id = ?', ids[0]) ?? 'Folder'
    const media = repo.idsForQuery(l, { view: { type: 'folder', ids, recursive: true }, sort: 'date', dir: 'asc' })
    return ops.createAlbum(name, media)
  },

  // ── import ──
  'import.preview': (paths) => previewImport(lib(), paths),
  'import.start': (req) => {
    if (!ctx.importer) throw new Error('No library is open')
    return ctx.importer.start(req)
  },
  'import.startForced': (req) => {
    if (!ctx.importer) throw new Error('No library is open')
    return ctx.importer.start(req, true)
  },
  'import.cancel': () => ctx.importer?.cancel(),

  // ── activity ──
  'activity.status': () => activityStatus(),
  'activity.setPaused': (p) => {
    ctx.indexer?.setPaused(p)
    broadcastActivity()
  },

  'search.suggest': (text) => suggest(text),

  'history.undo': () => history.undo(),
  'history.redo': () => history.redo(),
  'history.state': () => history.state(),

  // ── video ──
  'video.storyboard': (id) => storyboardFor(id),
  'video.playable': (id, direct) => playable(id, direct),
  'video.cancelTranscode': (id) => cancelTranscode(id),
  'video.probeCodec': (id) => probeCodec(id),

  // ── converter ──
  'convert.expand': async (paths) => {
    const items = await expandPaths(paths)
    allowExternal(items.map((i) => i.path))
    return items
  },
  'convert.fromMedia': (ids) => fromMedia(ids),
  'convert.start': (items, opts) => {
    ensurePool()
    allowExternal(items.map((i) => i.path))
    return startConvert(items, opts)
  },
  'convert.cancel': (jobId) => cancelConvert(jobId),

  // ── external files (opened from the OS) ──
  'external.open': async (paths) => {
    const supported = paths.filter((p) => isSupportedPath(p) && existsSync(p))
    let files = supported
    let startIndex = 0
    if (supported.length === 1) {
      // Browse the rest of the folder with ←/→ like a system photo viewer.
      const dir = dirname(supported[0])
      const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => !n.startsWith('.') && isSupportedPath(n))
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      files = names.map((n) => join(dir, n))
      startIndex = Math.max(0, files.indexOf(supported[0]))
      if (files.length > 5000) {
        files = supported
        startIndex = 0
      }
    }
    allowExternal(files, supported.length === 1)
    const l = ctx.library
    const out: ExternalFile[] = files.map((p) => {
      const ext = extOf(p)
      const kind = kindOfExt(ext)!
      let size = 0
      try {
        size = statSync(p).size
      } catch {
        /* ignore */
      }
      let mediaId: number | undefined
      if (l) {
        const s = l.toStored(p)
        mediaId = l.db.value<number>('SELECT id FROM media WHERE in_library = ? AND path = ? AND deleted_at IS NULL', s.inLibrary, s.path)
      }
      const enc = encodeURIComponent(p)
      return {
        path: p,
        name: basename(p),
        kind,
        size,
        mediaId,
        url: kind === 'photo' && needsPreview(ext) ? `loupe://ext/preview?p=${enc}` : `loupe://ext/file?p=${enc}`
      }
    })
    return { files: out, startIndex }
  },
  'external.thumbUrl': (p) => `loupe://ext/thumb?p=${encodeURIComponent(p)}`,
  'external.allow': (paths) => allowExternal(paths),

  // ── collage ──
  'collage.save': async (data, format, suggestedName, addToLibrary) => {
    const w = win()
    const ext = format === 'jpeg' ? 'jpg' : format
    const opts: Electron.SaveDialogOptions = {
      title: 'Export Collage',
      defaultPath: join(app.getPath('pictures'), `${suggestedName}.${ext}`),
      filters: [{ name: format.toUpperCase(), extensions: [ext] }]
    }
    const r = TEST_DIALOG_DIR ? { canceled: false, filePath: join(TEST_DIALOG_DIR, `${suggestedName}.${ext}`) } : w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const { writeFile } = await import('node:fs/promises')
    await writeFile(r.filePath, Buffer.from(data))
    if (addToLibrary && ctx.importer) ctx.importer.start({ paths: [r.filePath], mode: 'copy' }, true)
    return { path: r.filePath }
  },
  'collage.imageUrl': (id) => mediaUrl(id),

  // ── duplicates ──
  'duplicates.scan': (opts) => scanDuplicates(opts),
  'duplicates.ignore': (ids) => ignoreGroup(ids),

  // ── backup & cache ──
  'backup.create': () => createBackup(win()),
  'backup.restore': () => restoreBackup(win(), openLibrary),
  'cache.clearPreviews': async () => {
    const l = lib()
    await rm(l.dir('previews'), { recursive: true, force: true })
    await rm(l.cachePath('storyboards'), { recursive: true, force: true })
    await rm(l.cachePath('external'), { recursive: true, force: true })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(l.dir('previews'), { recursive: true })
    void prunePreviews()
    return 0
  },
  'cache.rebuildThumbnails': () => {
    const l = lib()
    const ids = l.db.all<{ id: number }>('SELECT id FROM media WHERE deleted_at IS NULL ORDER BY sort_date DESC').map((r) => r.id)
    l.db.run('UPDATE media SET thumb_state = 0 WHERE deleted_at IS NULL')
    ctx.indexer?.enqueue(ids)
    ctx.changes.items(ids)
    return ids.length
  }
}

export function registerIpc(): void {
  ipcMain.handle('api', async (_e, method: keyof Api, args: unknown[]) => {
    const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined
    if (!fn) return { e: `Unknown method ${String(method)}` }
    try {
      return { r: await fn(...(args ?? [])) }
    } catch (err) {
      console.error(`[api] ${String(method)} failed:`, err)
      return { e: err instanceof Error ? err.message : String(err) }
    }
  })
}

export { closeLibrary }
