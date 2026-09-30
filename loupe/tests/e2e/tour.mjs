// Screenshots every major surface of an existing test library (run smoke.mjs first).
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const work = resolve('test-data/e2e')
const shots = resolve(process.env.SHOTS ?? 'test-data/screenshots')
mkdirSync(shots, { recursive: true })
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron'),
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, LOUPE_USER_DATA: join(work, 'userdata') }
})
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await win.setViewportSize({ width: 1400, height: 880 })
const shot = async (name, wait = 400) => { await win.waitForTimeout(wait); await win.screenshot({ path: join(shots, `${name}.png`) }); console.log('shot', name) }
const invoke = (method, ...args) => win.evaluate(([m, a]) => window.loupe.invoke(m, ...a), [method, args])
const setPrefs = async (p) => { await invoke('app.setPrefs', p); await win.evaluate((p) => window.__setPrefs?.(p), p) }
await win.waitForSelector('[data-gallery-scroller]', { timeout: 20000 })
await setPrefs({ layout: 'grid', thumbSize: 190 })
await win.reload()
await win.waitForSelector('[data-media-id]', { timeout: 20000 })
await win.waitForTimeout(800)

// Select + info panel
const cells = await win.$$('[data-media-id]')
await cells[6].click()
await win.keyboard.press('ArrowRight')
await win.keyboard.down('Shift'); await win.keyboard.press('ArrowRight'); await win.keyboard.press('ArrowRight'); await win.keyboard.up('Shift')
await shot('10-multi-select')
await cells[0].click()
await win.click('button[aria-label^="Info"]')
await shot('11-info-panel', 800)
await win.click('button[aria-label^="Info"]')

// Context menu
const photo = await win.$('[data-media-id]:nth-child(15)')
await (photo ?? cells[12]).click({ button: 'right' })
await shot('12-context-menu')
await win.keyboard.press('Escape')

// Viewer on a photo (find a JPEG with EXIF)
const ids = await invoke('media.idsForQuery', { view: { type: 'photos' }, search: 'IMG_2842', sort: 'date', dir: 'desc' })
await win.evaluate((id) => { const el = document.querySelector(`[data-media-id="${id}"]`); el?.scrollIntoView() }, ids[0])
await win.waitForTimeout(300)
await win.dblclick(`[data-media-id="${ids[0]}"] [data-frame]`)
await shot('13-viewer-photo', 1200)
await win.keyboard.press('i')
await shot('14-viewer-info', 900)
await win.keyboard.press('i')
await win.mouse.move(700, 440)
await win.mouse.wheel(0, -600)
await shot('15-viewer-zoomed', 700)
await win.keyboard.press('Escape')
await win.keyboard.press('Escape')
await win.waitForTimeout(400)

// HEIC in viewer (preview generation)
const heic = await invoke('media.idsForQuery', { view: { type: 'all' }, search: 'heic', sort: 'date', dir: 'desc' })
await win.evaluate((ids) => window.__openViewer?.(ids, 0), heic)
await shot('16-viewer-heic', 2500)
await win.keyboard.press('Escape')

// Video
const vids = await invoke('media.idsForQuery', { view: { type: 'videos' }, search: 'beach-walk', sort: 'date', dir: 'desc' })
await win.evaluate((ids) => window.__openViewer?.(ids, 0), vids)
await win.waitForTimeout(2500)
await win.mouse.move(700, 700)
await shot('17-viewer-video', 300)
await win.keyboard.press('Escape')
const avi = await invoke('media.idsForQuery', { view: { type: 'videos' }, search: 'old-camera', sort: 'date', dir: 'desc' })
await win.evaluate((ids) => window.__openViewer?.(ids, 0), avi)
await shot('18-viewer-avi-converting', 1500)
await win.waitForTimeout(6000)
await win.mouse.move(700, 700)
await shot('19-viewer-avi-playing', 300)
await win.keyboard.press('Escape')

// Layouts
for (const layout of ['list', 'timeline', 'large', 'filmstrip']) {
  await setPrefs({ layout })
  await shot(`20-layout-${layout}`, 1200)
}
await setPrefs({ layout: 'grid', info: { filename: true, date: true, type: true, resolution: false, size: false, duration: true, folder: false, rating: true, tags: false } })
await shot('21-grid-captions', 1000)

// Search
await win.click('input[aria-label="Search"]')
await win.keyboard.type('flor')
await shot('22-search-suggest', 900)
await win.keyboard.press('Escape')

// Dark mode
await setPrefs({ theme: 'dark', info: { filename: false, date: false, type: false, resolution: false, size: false, duration: true, folder: false, rating: true, tags: false } })
await shot('23-dark-grid', 1200)

// Routes
for (const r of ['settings', 'converter', 'collage', 'duplicates']) {
  await win.evaluate((r) => window.__navigate?.({ kind: r }), r)
  await shot(`30-${r}`, r === 'duplicates' ? 3000 : 1500)
}
await setPrefs({ theme: 'light' })
await win.evaluate(() => window.__navigate?.({ kind: 'view', view: { type: 'all' } }))

// Import dialog
await win.evaluate(() => window.__startImport?.(['/home/user/ThroughLine/loupe/test-data/varied/Vacation 2026']))
await shot('40-import-dialog', 1500)
await win.keyboard.press('Escape')

console.log('renderer errors:', errors.length ? errors.join('\n') : 'none')
await app.close()
