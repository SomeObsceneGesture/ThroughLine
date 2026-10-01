# Loupe

A private, local-first photo & video library for the desktop. Drag a folder in and start browsing — thumbnails, dates, camera details, albums, tags and search, all on your own computer. No account, no cloud, no internet connection required.

> Working name. The product name lives in `package.json` (`productName`), `electron-builder.yml`, and `src/main/index.ts` (`app.setName`).

## Quick start

```bash
cd loupe
npm install
npm run dev          # launches the app with hot reload
```

Build installers (run on the target OS — see [Packaging](#packaging)):

```bash
npm run dist:win     # Windows .exe installer (NSIS) with desktop + Start menu shortcuts
npm run dist:mac     # macOS .dmg (arm64 + x64)
npm run dist:linux   # AppImage + .deb
```

Other scripts: `npm run typecheck`, `npm run build`, `npm start` (preview the production build).

## What it does

**Library & import**
- First run: *Create New Library* or *Open Existing Library*. A library is an ordinary folder you choose (internal or external drive).
- Drag files or whole folder trees anywhere onto the window (or onto the app icon / "Open With"). Nested folders import in one go.
- Per import (or remembered): **Copy into library** or **Keep in current location** (reference). Originals are never modified.
- Duplicates are detected by content (size + head/tail hash, confirmed by full hash in the Duplicates tool), not by name.
- Items appear within a second or two; thumbnails and metadata fill in on background worker threads while you browse. Visible items are thumbnailed first. Progress sits unobtrusively in the sidebar with pause/stop.

**Browsing**
- Layouts: Grid, Masonry, Large, Filmstrip, Timeline (month headers + year scrubber), List (sortable columns). All virtualized.
- Thumbnail size slider, density (compact/comfortable/spacious), crop-to-square toggle, and optional captions: filename, date, type, resolution, size, duration, folder, rating, tags. Preferences persist.
- Views: All Media, Photos, Videos, Favorites, Recently Added, Recently Viewed, Timeline, Albums, Tags, Folders (real filesystem tree, multi-select), Recently Deleted, Last Import.
- Selection: click, Ctrl/⌘-click, Shift-click ranges, rubber-band drag, keyboard arrows (+Shift), Select All.

**Organising**
- Tags (create, rename, merge, delete, batch apply), albums (reference items — no copies; custom order by drag), favorites, 0–5 star ratings, non-destructive rotation.
- Drag photos onto an album, tag, Favorites, Recently Deleted, *New album*, Collage Studio or Image Converter in the sidebar. Drag files from the desktop straight onto an album.
- Rename and Move to… operate on the real files and never overwrite.
- **Undo/Redo** (Ctrl/⌘+Z) for tags, albums, favorites, ratings, rotation, rename, move, delete-to-Recently-Deleted, folder removal and imports. Permanent deletion always asks first and offers *Remove from Library Only* vs *Move Files to Trash* (the OS trash, still recoverable).

**Search** — updates as you type, forgiving substring matching over filenames, folder paths, tags, albums, camera and lens, plus recognised words: years (`2019`), months (`june`), types (`videos`, `heic`, `raw`), orientation (`portrait`), resolution (`4k`). Optional operators: `#tag`, `album:"Florida 2026"`, `folder:beach`, `camera:canon`, `ext:png`, `rating>=4`, `before:2020`, `after:2021-06`, `size>10mb`, `-exclude`. Suggestions for tags, albums, folders, dates and cameras appear under the field.

**Viewer** — opens with a zoom from the thumbnail; instant thumbnail first, full resolution when decoded; neighbours preloaded. Zoom (wheel/pinch, +/−), fit / fill / 100 %, pan, rotate, favorite, tags, add to album, slideshow (fade), info panel with EXIF (camera, lens, exposure, GPS), filmstrip, full screen.

**Video** — built-in player: play/pause, seek with storyboard frame previews on hover, volume, speed (0.25–2×), loop, picture-in-picture, full screen, frame stepping, J/K/L. Formats Chromium can't decode (AVI/MPEG-4 Part 2, WMV, HEVC on systems without a decoder…) are converted once to H.264 in the background with progress and cached in the library.

**Tools**
- **Image Converter** — batch HEIC/RAW/PNG/TIFF/WEBP/… → JPEG, PNG, WEBP, AVIF or TIFF; quality, resize (longest edge / width / height / %), rename pattern (`{name}`, `{n}`, `{date}`), destination (subfolder / same folder / chosen folder), preserve metadata (HEIC EXIF is carried into JPEG), remove GPS, optionally add results to the library. Never overwrites.
- **Collage Studio** — 14 templates + freeform; drag photos into cells, drag gutters to resize, pan/zoom crop inside cells, swap cells, spacing, margin, corners, border, shadow, background colour or blurred photo, text layers, 10 aspect ratios, its own undo. Exports JPEG/PNG/WEBP up to 6000 px.
- **Duplicates** — identical files by content, plus "look-alikes" (resized/re-saved) via perceptual hashing; side-by-side compare with synced zoom; Keep All / Remove Others / Remove All Extras (to Recently Deleted).

**Settings** — Library (location, contents & disk usage, import behaviour, organisation of copies, duplicates, rescan on launch, rebuild thumbnails, clear previews), Appearance (system/light/dark, 7 accents, density, thumbnail size, sidebar), Performance (worker threads, thumbnail quality, preview cache limit, hardware acceleration), Viewer, Metadata, Keyboard Shortcuts, Backup & Recovery, About.

**Backup** — a single `.loupebackup` file with the database, a readable `organization.json` (albums, tags, favorites, ratings) and settings. The UI states plainly that it does **not** contain photos. Restore keeps a safety copy of the current database.

## Supported formats

| Kind | Formats |
|---|---|
| Photos | JPEG, PNG, WebP, GIF, AVIF, TIFF, BMP, SVG, HEIC/HEIF |
| RAW | DNG, CR2, CR3, NEF, NRW, ARW, ORF, RW2, RAF, PEF, SRW and others — via the full-size JPEG preview the camera embeds |
| Video | MP4, MOV, MKV, WebM, AVI, WMV, MPEG, M2TS/MTS, 3GP, FLV, OGV |

## Library layout

```
My Library/
├── Originals/     files copied in by "Copy into library" (folder structure preserved)
├── Thumbnails/    generated thumbnails — safe to delete, rebuilt automatically
├── Previews/      full-screen previews for HEIC/RAW/TIFF — size-capped, safe to delete
├── Database/      library.db (SQLite): albums, tags, favorites, ratings, metadata
├── Cache/         video storyboards, playable copies — safe to delete
├── library.json   identity + format version
└── README.txt     explains all of the above to anyone browsing the folder
```

Paths inside the library are stored relative, so a library on an external drive keeps working when the drive letter or mount point changes. Referenced folders on a disconnected drive show as offline (thumbnails stay browsable) and can be re-pointed with *Relocate Folder…*.

## Architecture

```
Renderer (React 19, Tailwind 4, zustand)            sandboxed, contextIsolation
  │  window.loupe.invoke(method, …)  — one typed channel (src/shared/api.ts)
  │  loupe:// protocol — thumbnails, originals (HTTP Range for video), previews
Main process (Electron 44 / Node 24)
  ├─ node:sqlite (bundled with Electron — no native rebuild), WAL, FTS5 trigram search
  ├─ Importer: streaming directory scan → probe (worker) → dedupe → copy → batched inserts
  ├─ Indexer: priority queue (visible items first) → worker pool → batched updates
  ├─ Undo history, file operations, converter, duplicates, backup, video transcoding
  └─ worker_threads pool (priority lanes: interactive > import > background)
        sharp/libvips · heic-decode (libheif wasm) · RAW preview extraction ·
        BMP decoder · exifr · ffprobe/ffmpeg (bundled binaries)
```

Key choices:
- **Only the layout index crosses to the renderer for a whole view** — ids, aspect ratios, dates and flags as typed arrays (~16 bytes per item). Item details are fetched only for what's on screen, in batches, with an LRU cache.
- **All heavy work is off the main thread.** The UI and IPC stay responsive during a 15,000-file import.
- **Nothing touches originals** except explicit Rename / Move / Move-to-Trash, and file operations never overwrite.

Source map: `src/main` (process, library, import, workers, video, tools), `src/preload` (bridge), `src/shared` (types, API contract, formats, search parser), `src/renderer/src` (UI).

## Testing

```bash
python3 scripts/make-test-media.py            # varied set: formats, EXIF, HEIC, RAW, videos, broken files, duplicates
node scripts/make-scale-media.mjs 15300 200   # 15,300 unique photos + 200 videos over 10 years
npm run build
xvfb-run -a node tests/e2e/functional.mjs     # ~50 functional checks against the real app
xvfb-run -a node tests/e2e/tour.mjs           # screenshots of every surface (after smoke.mjs)
xvfb-run -a node tests/e2e/scale.mjs          # performance run (writes results.json)
xvfb-run -a node tests/e2e/memory.mjs         # renderer memory with no debugger attached
```

`tests/e2e/*` drive the built app through Playwright's Electron support. `LOUPE_USER_DATA` isolates the profile; `LOUPE_TEST_DIALOG_DIR` stands in for native file dialogs.

## Packaging

`electron-builder.yml` produces an NSIS installer (desktop + Start menu shortcuts, choosable install dir), a DMG, an AppImage and a .deb, with file associations for images, RAW and video ("Open With → Loupe"). Opening a single file shows it in the viewer with ←/→ through the rest of its folder; folders dropped on the icon go to import. The app is single-instance and remembers window size, position and the last library.

Build each platform on that OS (or a CI matrix): `ffmpeg-static`, `@ffprobe-installer/*` and sharp's `@img/*` packages install the host platform's binaries. The exception is Windows, which can also be built from Linux:

```bash
npm run build && bash scripts/dist-win-from-linux.sh   # → dist/Loupe-Setup-<version>-x64.exe
```

That script stages the app with the Windows builds of sharp, ffmpeg and ffprobe, then builds with the Windows Electron. It sets the exe's icon and version info in JavaScript, because electron-builder's own editor needs Wine. Wine with 32-bit support is still required for the uninstaller step (`wine32:i386` on Ubuntu).

Code signing and notarisation are not configured. The first time an unsigned installer runs, Windows SmartScreen shows "Windows protected your PC"; choose **More info → Run anyway**. macOS shows a similar Gatekeeper prompt.

`LOUPE_EXE=dist/linux-unpacked/loupe xvfb-run -a node tests/e2e/functional.mjs` runs the functional suite against a packaged build.

## Performance

15,500-item library, 4-core Linux container with software rendering. Details, method and caveats are in [`SCALE-RESULTS.md`](SCALE-RESULTS.md).

- **Import:** first items appear 1.4 s after the drop. All 15,500 are browsable in 48 s, and thumbnails finish in the background (7 min on Linux's WebAssembly libvips).
- **Cold start:** thumbnails are painted 0.8 s after launch. The full layout loads in 77 ms, and searches take 4–27 ms.
- **Scrolling:** steady scrolling holds 60 fps. Only 42–65 DOM cells exist at any time.
- **Viewer:** next/previous shows the full-resolution photo in 5 ms (median).
- **Renderer memory:** about 400 MB private after sweeping every thumbnail, most of it Chromium's purgeable decoded-image cache. The app's own JS and DOM heaps are under 20 MB.

## Known limitations

- **Linux uses sharp's WebAssembly build.** Electron's Linux binary exports the system glib, which collides with the glib inside sharp's native libvips; libvips objects leak and a long import eventually aborts ([electron#46323](https://github.com/electron/electron/issues/46323)). Loading with `RTLD_DEEPBIND` fixes glib but corrupts the heap (it rebinds `malloc`/`free` away from Electron's allocator). The WASM build is clean but ~2.3× slower at thumbnailing. Windows and macOS use native libvips. `LOUPE_NATIVE_SHARP=1` forces native for testing.
- **RAW** support uses the camera's embedded preview (full size on most modern bodies). RAW files without a usable preview show a clear "no preview" message rather than a thumbnail.
- **HEIC colour profiles** (Display P3) are not carried into thumbnails or conversions, so wide-gamut colours can look slightly less saturated. EXIF (date, camera, GPS) is preserved.
- **HEVC video** plays natively where the OS provides a decoder; otherwise it's converted once (and cached) before playing.
- Tested here on Linux under Xvfb only (software rendering). Windows/macOS builds are configured but were not run on real hardware in this environment.
