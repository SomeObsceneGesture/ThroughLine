// A library is a plain, user-visible folder:
//
//   My Library/
//   ├── Originals/     media copied in by "Copy into library" imports
//   ├── Thumbnails/    generated grid thumbnails (safe to delete; rebuilt)
//   ├── Previews/      generated full-screen previews for HEIC/RAW/TIFF (safe to delete)
//   ├── Database/      library.db — albums, tags, favorites, metadata
//   ├── Cache/         video storyboards, playable copies, temp files (safe to delete)
//   ├── library.json   identity + format version
//   └── README.txt     explains the above
//
// Referenced ("keep in current location") media is never moved or modified.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, isAbsolute, sep, resolve, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Database } from './db'

export const DIRS = {
  originals: 'Originals',
  thumbnails: 'Thumbnails',
  previews: 'Previews',
  database: 'Database',
  cache: 'Cache'
} as const

const README = `This folder is a Loupe library.

Originals/    Photos and videos that were copied into the library.
              Files imported with "Keep in current location" stay where
              they were and are NOT stored here.
Thumbnails/   Small images generated for browsing. Safe to delete;
              Loupe rebuilds them.
Previews/     Large images generated for viewing formats such as HEIC,
              RAW and TIFF. Safe to delete.
Database/     library.db holds your albums, tags, favorites, ratings and
              metadata. Back it up with Loupe > Settings > Backup.
Cache/        Temporary files (video previews, playable copies). Safe to
              delete.

Backing up the Database does not back up your photos. To back up the
photos themselves, copy the Originals folder (and any folders you
imported by reference) to another drive.
`

export interface LibraryManifest {
  format: 'loupe-library'
  version: number
  id: string
  name: string
  createdAt: number
}

export function isLibraryFolder(dir: string): boolean {
  return existsSync(join(dir, 'library.json')) || existsSync(join(dir, DIRS.database, 'library.db'))
}

export class Library {
  readonly db: Database
  readonly manifest: LibraryManifest

  private constructor(readonly root: string, manifest: LibraryManifest) {
    this.manifest = manifest
    for (const d of Object.values(DIRS)) mkdirSync(join(root, d), { recursive: true })
    this.db = new Database(join(root, DIRS.database, 'library.db'))
  }

  static create(parentDir: string, name: string): Library {
    const root = resolve(parentDir, name)
    if (existsSync(root)) {
      if (isLibraryFolder(root)) return Library.open(root)
      const entries = readdirSync(root).filter((e) => !e.startsWith('.'))
      if (entries.length > 0) {
        throw new Error(`"${basename(root)}" already exists and isn't empty. Choose a different name or location.`)
      }
    }
    mkdirSync(root, { recursive: true })
    const manifest: LibraryManifest = {
      format: 'loupe-library',
      version: 1,
      id: randomUUID(),
      name,
      createdAt: Date.now()
    }
    writeFileSync(join(root, 'library.json'), JSON.stringify(manifest, null, 2))
    writeFileSync(join(root, 'README.txt'), README)
    return new Library(root, manifest)
  }

  static open(root: string): Library {
    root = resolve(root)
    if (!existsSync(root)) throw new Error('LIBRARY_MISSING')
    if (!isLibraryFolder(root)) throw new Error("This folder isn't a Loupe library.")
    let manifest: LibraryManifest
    try {
      manifest = JSON.parse(readFileSync(join(root, 'library.json'), 'utf8'))
    } catch {
      manifest = {
        format: 'loupe-library',
        version: 1,
        id: randomUUID(),
        name: basename(root),
        createdAt: statSync(root).birthtimeMs || Date.now()
      }
      writeFileSync(join(root, 'library.json'), JSON.stringify(manifest, null, 2))
    }
    if (!existsSync(join(root, 'README.txt'))) writeFileSync(join(root, 'README.txt'), README)
    return new Library(root, manifest)
  }

  get name(): string {
    return basename(this.root)
  }

  dir(d: keyof typeof DIRS): string {
    return join(this.root, DIRS[d])
  }

  /** Resolve a stored path (relative for in-library files) to an absolute path. */
  resolve(path: string, inLibrary: number | boolean): string {
    return inLibrary ? join(this.root, ...path.split('/')) : path
  }

  /** Convert an absolute path to its stored form. */
  toStored(abs: string): { path: string; inLibrary: number } {
    const rel = relative(this.root, abs)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return { path: rel.split(sep).join('/'), inLibrary: 1 }
    }
    return { path: abs, inLibrary: 0 }
  }

  contains(abs: string): boolean {
    const rel = relative(this.root, abs)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  private shard(id: number): string {
    return (id % 256).toString(16).padStart(2, '0')
  }

  thumbPath(id: number): string {
    return join(this.root, DIRS.thumbnails, this.shard(id), `${id}.webp`)
  }

  previewPath(id: number): string {
    return join(this.root, DIRS.previews, this.shard(id), `${id}.jpg`)
  }

  cachePath(...parts: string[]): string {
    return join(this.root, DIRS.cache, ...parts)
  }

  getMeta(key: string): string | undefined {
    return this.db.value<string>('SELECT value FROM meta WHERE key = ?', key)
  }

  setMeta(key: string, value: string): void {
    this.db.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  close(): void {
    this.db.close()
  }
}
