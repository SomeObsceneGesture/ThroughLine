// Functional end-to-end checks against the real app (Electron + Playwright).
// Usage: xvfb-run -a node tests/e2e/functional.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, existsSync, readdirSync, cpSync, statSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const src = resolve('test-data/varied')
const work = resolve('test-data/functional')
const out = join(work, 'out')
rmSync(work, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
// A private copy of the media so file operations can't touch the fixtures.
const media = join(work, 'media')
cpSync(src, media, { recursive: true })

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron'),
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, LOUPE_USER_DATA: join(work, 'userdata'), LOUPE_TEST_DIALOG_DIR: out }
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
await win.setViewportSize({ width: 1400, height: 880 })
const invoke = (method, ...args) => win.evaluate(([m, a]) => window.loupe.invoke(m, ...a), [method, args])
const idle = async (limit = 120000) => {
  const t = Date.now()
  for (;;) {
    const s = await invoke('activity.status')
    if (!s.import && s.processing.total === 0) return Date.now() - t
    if (Date.now() - t > limit) throw new Error('timeout: ' + JSON.stringify(s))
    await win.waitForTimeout(250)
  }
}
const q = (search, view = { type: 'all' }) => invoke('media.idsForQuery', { view, search, sort: 'date', dir: 'desc' })

await win.waitForSelector('text=Welcome to Loupe', { timeout: 20000 })
const lib = await invoke('library.create', work, 'Func Library')
check('create library', lib.ok, lib.error)
const libRoot = join(work, 'Func Library')
check('library folders exist', ['Originals', 'Thumbnails', 'Previews', 'Database', 'Cache'].every((d) => existsSync(join(libRoot, d))))

// ── copy import preserves structure ──
await invoke('import.start', { paths: [join(media, 'Vacation 2026')], mode: 'copy' })
const ms = await idle()
const counts1 = await invoke('library.counts')
const expected = (await invoke('import.preview', [join(media, 'Vacation 2026')])).files
check('copy import count', counts1.all === expected, `all=${counts1.all} expected=${expected} in ${ms}ms`)
check('copied files keep folder structure', existsSync(join(libRoot, 'Originals', 'Vacation 2026', 'Florida', 'Beach', 'IMG_2840.JPG')))
check('originals untouched', existsSync(join(media, 'Vacation 2026', 'Florida', 'Beach', 'IMG_2840.JPG')))

// ── re-import: duplicates skipped ──
await invoke('import.start', { paths: [join(media, 'Vacation 2026')], mode: 'copy' })
await idle()
const counts2 = await invoke('library.counts')
check('re-import adds nothing (content duplicates)', counts2.all === counts1.all, `all=${counts2.all}`)

// ── reference import of the rest ──
await invoke('import.start', { paths: [join(media, 'Videos'), join(media, 'Raw Files'), join(media, 'Broken'), join(media, 'Duplicates')], mode: 'reference' })
await idle()
const counts3 = await invoke('library.counts')
check('reference import', counts3.all >= 32, `all=${counts3.all} videos=${counts3.videos}`)
const tree = await invoke('folders.tree')
check('folder tree has roots', tree.filter((f) => f.parentId === null).length >= 4, tree.filter((f) => f.parentId === null).map((f) => f.name).join(', '))

// ── search ──
const beach = await q('beach', { type: 'photos' })
check('search by folder name', beach.length === 6, `${beach.length}`)
check('search matches filename too', (await q('beach')).length === 7)
check('search by year', (await q('2026')).length >= 18)
check('search by month name', (await q('july')).length >= 10)
check('search type words', (await q('videos')).length === counts3.videos, `${(await q('videos')).length} vs ${counts3.videos}`)
check('search extension', (await q('heic')).length === 3)
check('search camera', (await q('canon')).length >= 6)
check('search forgiving substring', (await q('evergl')).length === 5)
check('search exclude', (await q('beach -2842', { type: 'photos' })).length === 5)
check('search orientation', (await q('portrait')).length >= 2)

// ── tags + undo ──
await invoke('tags.add', beach, ['Florida', 'Beach'])
let tags = await invoke('tags.list')
check('tags created', tags.some((t) => t.name === 'Florida' && t.count === 6))
check('search #tag', (await q('#florida')).length === 6)
const fl = tags.find((t) => t.name === 'Florida')
await invoke('tags.rename', fl.id, 'Sunshine State')
check('tag rename', (await invoke('tags.list')).some((t) => t.name === 'Sunshine State'))
await invoke('history.undo')
check('undo tag rename', (await invoke('tags.list')).some((t) => t.name === 'Florida'))
const beachTag = (await invoke('tags.list')).find((t) => t.name === 'Beach')
await invoke('tags.rename', beachTag.id, 'florida')
tags = await invoke('tags.list')
check('rename onto existing tag merges', tags.filter((t) => t.name.toLowerCase() === 'florida').length === 1 && !tags.some((t) => t.name === 'Beach'))
await invoke('history.undo')
check('undo merge restores both tags', (await invoke('tags.list')).some((t) => t.name === 'Beach'))

// ── albums + undo ──
const album = await invoke('albums.create', 'Trip', beach.slice(0, 3))
check('album created', album.count === 3)
await invoke('albums.addItems', album.id, beach.slice(3))
await invoke('albums.reorder', album.id, [beach[4]], beach[0])
const order = await invoke('media.idsForQuery', { view: { type: 'album', id: album.id }, sort: 'manual', dir: 'asc' })
check('album reorder', order[0] === beach[4], order.join(','))
await invoke('albums.delete', album.id)
check('album deleted', !(await invoke('albums.list')).some((a) => a.id === album.id))
await invoke('history.undo')
const restored = await invoke('albums.list')
check('undo album delete restores items', restored.some((a) => a.id === album.id && a.count === 6))
check('search album name', (await q('album:trip')).length === 6)

// ── favorites / rating via keyboard ──
await win.evaluate(() => window.__navigate({ kind: 'view', view: { type: 'all' } }))
await win.waitForSelector('[data-media-id]')
const firstId = await win.evaluate(() => Number(document.querySelector('[data-media-id]').dataset.mediaId))
await win.click(`[data-media-id="${firstId}"] [data-frame]`)
await win.keyboard.press('f')
await win.keyboard.press('4')
await win.waitForTimeout(400)
let [item] = await invoke('media.items', [firstId])
check('F favorites via keyboard', item.favorite === true)
check('4 rates via keyboard', item.rating === 4)
await win.keyboard.press('Control+z')
await win.waitForTimeout(300)
;[item] = await invoke('media.items', [firstId])
check('Ctrl+Z undoes rating', item.rating === 0, `rating=${item.rating}`)

// ── trash / restore / permanent delete ──
const broken = await q('not-really')
await invoke('media.trash', broken)
check('trash hides item', (await q('not-really')).length === 0 && (await invoke('library.counts')).deleted === 1)
await invoke('media.restore', broken)
check('restore brings it back', (await q('not-really')).length === 1)
await invoke('media.trash', broken)
const del = await invoke('media.deletePermanently', broken, false)
check('permanent delete (library only) keeps file', del.removed === 1 && existsSync(join(media, 'Broken', 'not-really.jpg')))

// ── rename / move on disk ──
const [gator] = await q('gator_0')
const rn = await invoke('media.rename', gator, 'Alligator')
const copied = join(libRoot, 'Originals', 'Vacation 2026', 'Florida', 'Everglades')
check('rename keeps extension', rn.ok && rn.name === 'Alligator.jpg' && existsSync(join(copied, 'Alligator.jpg')), JSON.stringify(rn))
await invoke('history.undo')
check('undo rename', existsSync(join(copied, 'gator_0.jpg')) && !existsSync(join(copied, 'Alligator.jpg')))
const clash = await invoke('media.rename', gator, 'gator_1')
check('rename refuses to overwrite', !clash.ok, clash.error)
const moveDir = join(work, 'moved')
mkdirSync(moveDir)
const mv = await invoke('media.move', [gator], moveDir)
check('move file', mv.moved === 1 && existsSync(join(moveDir, 'gator_0.jpg')))
await invoke('history.undo')
check('undo move', existsSync(join(copied, 'gator_0.jpg')) && !existsSync(join(moveDir, 'gator_0.jpg')))

// ── converter ──
const heics = await invoke('convert.fromMedia', await q('heic'))
const jobDone = win.evaluate(() => new Promise((res) => { const off = window.loupe.on('convert:progress', (p) => { if (p.finished) { off(); res(p) } }) }))
await invoke('convert.start', heics, { format: 'jpeg', quality: 85, resize: 'long', resizeValue: 1600, naming: '{name}-web', destination: 'custom', customDir: out, subfolderName: 'Converted', keepMetadata: true, stripLocation: false, addToLibrary: false })
const job = await jobDone
check('convert HEIC → JPEG', job.outputs.length === 3 && job.failed === 0, `${job.outputs.map((p) => basename(p)).join(', ')}`)
const meta = await sharp(join(out, 'IMG_3000-web.jpg')).metadata()
check('converted size + EXIF kept', Math.max(meta.width, meta.height) === 1600 && (meta.exif?.length ?? 0) > 100, `${meta.width}x${meta.height} exif=${meta.exif?.length}`)
const job2Done = win.evaluate(() => new Promise((res) => { const off = window.loupe.on('convert:progress', (p) => { if (p.finished) { off(); res(p) } }) }))
await invoke('convert.start', heics.slice(0, 1), { format: 'jpeg', quality: 85, resize: 'long', resizeValue: 1600, naming: '{name}-web', destination: 'custom', customDir: out, subfolderName: 'Converted', keepMetadata: true, stripLocation: false, addToLibrary: false })
const job2 = await job2Done
const firstName = basename(heics[0].path).replace(/\.[^.]+$/, '')
check('converter never overwrites', basename(job2.outputs[0]) === `${firstName}-web (1).jpg`, basename(job2.outputs[0] ?? ''))

// ── collage export through the UI ──
const photos = (await q('', { type: 'photos' })).slice(0, 4)
await win.evaluate((ids) => { window.__navigate({ kind: 'view', view: { type: 'all' } }) }, photos)
await win.evaluate((ids) => window.__openCollage?.(ids), photos)
await win.waitForSelector('text=Collage Studio', { timeout: 5000 })
await win.waitForTimeout(1500)
await win.click('button:has-text("Export…")')
for (let i = 0; i < 60 && !readdirSync(out).some((f) => f.startsWith('Collage')); i++) await win.waitForTimeout(250)
const collageFile = readdirSync(out).find((f) => f.startsWith('Collage'))
const cm = collageFile ? await sharp(join(out, collageFile)).metadata() : null
check('collage exported at chosen resolution', !!cm && cm.width === 3000 && cm.height === 3000, collageFile ?? 'missing')
await win.screenshot({ path: resolve('test-data/screenshots/50-collage-filled.png') })

// ── duplicates ──
const dups = await invoke('duplicates.scan', { similar: true, threshold: 6 })
check('duplicate scan finds resized copy', dups.groups.some((g) => g.items.some((m) => m.filename === 'IMG_2843-small.jpg')), `${dups.groups.length} groups`)
check('videos of different length are not look-alikes', !dups.groups.some((g) => g.items.some((m) => m.filename === 'one-minute.mp4') && g.items.some((m) => m.filename === 'boat.mov')))

// ── backup / restore ──
const bk = await invoke('backup.create')
check('backup written', !!bk && existsSync(bk.path) && statSync(bk.path).size > 1000, bk?.path)
const before = await invoke('library.counts')
const rs = await invoke('backup.restore')
await win.waitForTimeout(800)
const after = await invoke('library.counts')
check('restore round-trips', rs?.ok && after.all === before.all, `${before.all} → ${after.all}`)
check('pre-restore safety copy kept', readdirSync(join(libRoot, 'Database')).some((f) => f.includes('before-restore')))

check('no renderer errors', errors.length === 0, errors.slice(0, 5).join(' | '))
await app.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
