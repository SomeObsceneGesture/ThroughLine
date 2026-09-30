// Drives the built app with Playwright's Electron support: creates a library,
// imports test media, and screenshots the main surfaces.
// Usage: xvfb-run -a node tests/e2e/smoke.mjs [mediaDir]
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

const media = resolve(process.argv[2] ?? 'test-data/varied')
const work = resolve('test-data/e2e')
const shots = resolve(process.env.SHOTS ?? 'test-data/screenshots')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync(shots, { recursive: true })

const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron'),
  args: ['--no-sandbox', resolve('out/main/index.js')],
  env: { ...process.env, LOUPE_USER_DATA: join(work, 'userdata'), ELECTRON_ENABLE_LOGGING: '1' }
})
const logs = []
app.process().stdout.on('data', (d) => logs.push(d.toString()))
app.process().stderr.on('data', (d) => logs.push(d.toString()))
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[renderer ${m.type()}]`, m.text()) })
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.setViewportSize({ width: 1400, height: 880 })
const shot = async (name) => {
  await win.waitForTimeout(350)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  console.log('shot', name)
}
const invoke = (method, ...args) => win.evaluate(([m, a]) => window.loupe.invoke(m, ...a), [method, args])

await win.waitForSelector('text=Welcome to Loupe', { timeout: 20000 })
await shot('01-welcome')

const t0 = Date.now()
const r = await invoke('library.create', work, 'Test Library')
console.log('library.create', r.ok, r.error ?? '')
await win.waitForSelector('text=Your library is', { timeout: 10000 })
await shot('02-empty-library')

await invoke('import.start', { paths: [media], mode: 'reference' })
const tImport = Date.now()
for (;;) {
  const s = await invoke('activity.status')
  if (!s.import && s.processing.total === 0) break
  if (Date.now() - tImport > 180000) { console.log('timeout waiting for processing', JSON.stringify(s)); break }
  await win.waitForTimeout(300)
}
console.log(`import+processing: ${Date.now() - tImport} ms`)
await win.waitForTimeout(1500)
await shot('03-grid')

await win.keyboard.press('Escape')
await win.evaluate(() => window.loupe.invoke('app.setPrefs', { layout: 'masonry' }))
await win.reload()
await win.waitForTimeout(2000)
await shot('04-masonry')

console.log('elapsed', Date.now() - t0)
console.log(logs.join('').split('\n').filter((l) => /error|Error|warn/i.test(l)).slice(0, 30).join('\n'))
await app.close()
