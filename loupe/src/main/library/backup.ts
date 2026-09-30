// Library backup: a single .loupebackup (ZIP) file containing the database,
// a human-readable export of albums/tags/favorites, and settings.
// It deliberately does NOT contain photos or videos — the UI says so.

import { app, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { lib } from '../context'
import { createZip, readZip } from '../util/zip'
import { prefs } from '../preferences'
import { DatabaseSync } from 'node:sqlite'

const README = `Loupe library backup

This file contains your library's organisation:
  library.db          the full library database (albums, tags, favorites,
                      ratings, metadata, import history)
  organization.json   the same albums/tags/favorites in a readable form
  preferences.json    your Loupe settings

It does NOT contain your photos or videos. Back up the library's
Originals folder, and any folders you imported by reference, separately.

To restore: Loupe > Settings > Backup > Restore from Backup…
`

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}

export async function createBackup(win: BrowserWindow | null): Promise<{ path: string } | null> {
  const l = lib()
  const testDir = process.env.LOUPE_TEST_DIALOG_DIR
  const res = testDir ? { canceled: false, filePath: join(testDir, 'Test Backup.loupebackup') } : await (win
    ? dialog.showSaveDialog(win, {
        title: 'Back Up Library',
        defaultPath: join(app.getPath('documents'), `${l.name} Backup ${stamp()}.loupebackup`),
        filters: [{ name: 'Loupe Backup', extensions: ['loupebackup'] }]
      })
    : dialog.showSaveDialog({ defaultPath: `${l.name} Backup.loupebackup` }))
  if (res.canceled || !res.filePath) return null
  const tmp = join(app.getPath('temp'), `loupe-backup-${Date.now()}.db`)
  l.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
  const dbBuf = await readFile(tmp)
  await rm(tmp, { force: true })

  const albums = l.db.all<{ id: number; name: string }>('SELECT id, name FROM albums ORDER BY sort_order')
  const organization = {
    format: 'loupe-organization',
    version: 1,
    exportedAt: new Date().toISOString(),
    library: { name: l.name, id: l.manifest.id, path: l.root },
    albums: albums.map((a) => ({
      name: a.name,
      items: l.db
        .all<{ path: string; in_library: number }>(
          'SELECT m.path, m.in_library FROM album_items ai JOIN media m ON m.id = ai.media_id WHERE ai.album_id = ? ORDER BY ai.position',
          a.id
        )
        .map((m) => (m.in_library ? `library:${m.path}` : m.path))
    })),
    tags: l.db.all<{ id: number; name: string }>('SELECT id, name FROM tags ORDER BY name').map((t) => ({
      name: t.name,
      items: l.db
        .all<{ path: string; in_library: number }>('SELECT m.path, m.in_library FROM media_tags mt JOIN media m ON m.id = mt.media_id WHERE mt.tag_id = ?', t.id)
        .map((m) => (m.in_library ? `library:${m.path}` : m.path))
    })),
    favorites: l.db.all<{ path: string; in_library: number }>('SELECT path, in_library FROM media WHERE favorite = 1').map((m) => (m.in_library ? `library:${m.path}` : m.path)),
    ratings: l.db
      .all<{ path: string; in_library: number; rating: number }>('SELECT path, in_library, rating FROM media WHERE rating > 0')
      .map((m) => ({ path: m.in_library ? `library:${m.path}` : m.path, rating: m.rating }))
  }
  const { recentLibraries: _r, lastLibrary: _l, window: _w, ...settings } = prefs.get()
  const zip = createZip([
    { name: 'README.txt', data: Buffer.from(README) },
    { name: 'library.json', data: Buffer.from(JSON.stringify(l.manifest, null, 2)) },
    { name: 'library.db', data: dbBuf },
    { name: 'organization.json', data: Buffer.from(JSON.stringify(organization, null, 2)) },
    { name: 'preferences.json', data: Buffer.from(JSON.stringify(settings, null, 2)) }
  ])
  await writeFile(res.filePath, zip)
  l.setMeta('last_backup', String(Date.now()))
  return { path: res.filePath }
}

/**
 * Replace the open library's database with the one from a backup. The current
 * database is kept alongside as library.db.before-restore-<time>.
 */
export async function restoreBackup(win: BrowserWindow | null, reopen: (path: string) => Promise<unknown>): Promise<{ ok: boolean; error?: string } | null> {
  const l = lib()
  const testDir = process.env.LOUPE_TEST_DIALOG_DIR
  const res = testDir ? { canceled: false, filePaths: [join(testDir, 'Test Backup.loupebackup')] } : await (win
    ? dialog.showOpenDialog(win, { title: 'Restore from Backup', properties: ['openFile'], filters: [{ name: 'Loupe Backup', extensions: ['loupebackup'] }] })
    : dialog.showOpenDialog({ properties: ['openFile'] }))
  if (res.canceled || !res.filePaths[0]) return null
  let entries: Map<string, Buffer>
  try {
    entries = readZip(await readFile(res.filePaths[0]))
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  const db = entries.get('library.db')
  if (!db) return { ok: false, error: 'This backup does not contain a library database.' }
  // Validate before touching anything.
  const probe = join(app.getPath('temp'), `loupe-restore-${Date.now()}.db`)
  await writeFile(probe, db)
  try {
    const test = new DatabaseSync(probe, { readOnly: true })
    test.prepare('SELECT count(*) FROM media').get()
    test.close()
  } catch {
    await rm(probe, { force: true })
    return { ok: false, error: 'The database in this backup is damaged or from an incompatible version.' }
  }
  const root = l.root
  const dbPath = join(root, 'Database', 'library.db')
  const { closeLibrary } = await import('./manager')
  await closeLibrary()
  const keep = `${dbPath}.before-restore-${stamp().replace(/[ :.]/g, '-')}`
  if (existsSync(dbPath)) await copyFile(dbPath, keep)
  await rm(`${dbPath}-wal`, { force: true })
  await rm(`${dbPath}-shm`, { force: true })
  await copyFile(probe, dbPath)
  await rm(probe, { force: true })
  const p = entries.get('preferences.json')
  if (p) {
    try {
      const restored = JSON.parse(p.toString('utf8'))
      delete restored.recentLibraries
      delete restored.lastLibrary
      delete restored.window
      prefs.set(restored)
    } catch {
      /* ignore */
    }
  }
  await reopen(root)
  return { ok: true }
}
