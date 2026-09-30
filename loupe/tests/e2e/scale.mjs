// Scale / performance test against a large generated library.
// Usage: xvfb-run -a node tests/e2e/scale.mjs [mediaDir=test-data/scale]
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const media = resolve(process.argv[2] ?? 'test-data/scale')
const work = resolve(process.env.SCALE_WORK ?? 'test-data/scale-run')
const shots = resolve('test-data/screenshots')
const fresh = process.env.REUSE !== '1'
if (fresh) rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync(shots, { recursive: true })
const results = {}
const log = (k, v) => {
  results[k] = v
  console.log(`${k.padEnd(44)} ${typeof v === 'number' ? v.toLocaleString() : JSON.stringify(v)}`)
}

async function launch() {
  const t0 = Date.now()
  const app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron'),
    args: ['--no-sandbox', resolve('out/main/index.js')],
    env: { ...process.env, LOUPE_USER_DATA: join(work, 'userdata') }
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  return { app, win, t0 }
}

const metrics = async (app) => {
  const m = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, mb: Math.round(p.memory.workingSetSize / 1024), cpu: Math.round(p.cpu.percentCPUUsage) })))
  const sum = (t) => m.filter((p) => p.type === t).reduce((n, p) => n + p.mb, 0)
  return { browser: sum('Browser'), renderer: sum('Tab'), gpu: sum('GPU'), total: m.reduce((n, p) => n + p.mb, 0) }
}

// Measures frame gaps while `fn` runs in the renderer.
const frameProbe = (win, ms) =>
  win.evaluate((ms) => new Promise((res) => {
    const gaps = []
    let last = performance.now()
    const start = last
    const tick = (t) => {
      gaps.push(t - last)
      last = t
      if (t - start < ms) requestAnimationFrame(tick)
      else {
        gaps.sort((a, b) => a - b)
        res({ frames: gaps.length, avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), max: +gaps[gaps.length - 1].toFixed(1), over50: gaps.filter((g) => g > 50).length })
      }
    }
    requestAnimationFrame(tick)
  }), ms)

const scrollSweep = (win, ms) =>
  win.evaluate((ms) => new Promise((res) => {
    const el = document.querySelector('[data-gallery-scroller]')
    const start = performance.now()
    const gaps = []
    let last = start
    let maxCells = 0
    const step = (t) => {
      gaps.push(t - last)
      last = t
      const p = (t - start) / ms
      el.scrollTop = (el.scrollHeight - el.clientHeight) * (p < 0.5 ? p * 2 : 2 - p * 2)
      maxCells = Math.max(maxCells, document.querySelectorAll('[data-media-id]').length)
      if (t - start < ms) requestAnimationFrame(step)
      else {
        gaps.sort((a, b) => a - b)
        res({ frames: gaps.length, avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), max: +gaps[gaps.length - 1].toFixed(1), maxDomCells: maxCells, scrollHeight: el.scrollHeight })
      }
    }
    requestAnimationFrame(step)
  }), ms)

// ── Run 1: import ──
if (fresh) {
  const { app, win } = await launch()
  const invoke = (m, ...a) => win.evaluate(([m, a]) => window.loupe.invoke(m, ...a), [m, a])
  await win.waitForSelector('text=Welcome to Loupe', { timeout: 20000 })
  await invoke('library.create', work, 'Scale Library')
  await win.waitForTimeout(500)
  const t0 = Date.now()
  await invoke('import.start', { paths: [media], mode: 'reference' })
  await win.waitForSelector('[data-media-id]', { timeout: 60000 })
  log('first items visible after drop (ms)', Date.now() - t0)
  // Browse while importing.
  const duringImport = await scrollSweep(win, 3000)
  log('scroll while importing: frame avg/p95/max ms', [duringImport.avg, duringImport.p95, duringImport.max])
  let s
  for (;;) {
    s = await invoke('activity.status')
    if (!s.import) break
    await win.waitForTimeout(500)
  }
  const importMs = Date.now() - t0
  log('import complete — all items browsable (ms)', importMs)
  log('items imported', (await invoke('library.counts')).all)
  const midMem = await metrics(app)
  log('memory during processing (MB)', midMem)
  const idleFrames = await frameProbe(win, 3000)
  log('idle UI frames during processing avg/p95/max', [idleFrames.avg, idleFrames.p95, idleFrames.max])
  const duringProc = await scrollSweep(win, 4000)
  log('scroll during thumbnailing: avg/p95/max ms', [duringProc.avg, duringProc.p95, duringProc.max])
  const lt0 = Date.now()
  const layout = await invoke('media.layout', { view: { type: 'all' }, sort: 'date', dir: 'desc' })
  log('layout query during processing (ms, round trip)', Date.now() - lt0)
  void layout
  for (;;) {
    s = await invoke('activity.status')
    if (!s.import && s.processing.total === 0) break
    await win.waitForTimeout(1000)
  }
  const procMs = Date.now() - t0
  log('all thumbnails + metadata done (ms)', procMs)
  log('throughput (items/s)', Math.round((results['items imported'] / procMs) * 1000))
  await app.close()
}

// ── Run 2: cold start with the big library ──
{
  const { app, win, t0 } = await launch()
  const invoke = (m, ...a) => win.evaluate(([m, a]) => window.loupe.invoke(m, ...a), [m, a])
  await win.waitForSelector('[data-media-id] img.loaded', { timeout: 60000 })
  log('cold start → first thumbnails painted (ms)', Date.now() - t0)
  await win.waitForTimeout(1500)
  await win.screenshot({ path: join(shots, '60-scale-grid.png') })

  const q = async (search, view = { type: 'all' }) => {
    const t = performance.now()
    const r = await invoke('media.layout', { view, search, sort: 'date', dir: 'desc' })
    return { ms: +(performance.now() - t).toFixed(1), n: r.total, sql: +r.queryMs.toFixed(1) }
  }
  log('layout all 15k (round trip ms / sql ms)', await q(''))
  for (const s of ['beach', '2019', 'june', 'fishing 2021', 'canon', 'videos', '#nope', 'img_0123', 'x-t5', 'portrait']) {
    log(`search "${s}"`, await q(s))
  }
  const ids = await invoke('media.idsForQuery', { view: { type: 'all' }, sort: 'date', dir: 'desc' })
  const it0 = Date.now()
  await invoke('media.items', ids.slice(0, 400))
  log('fetch 400 item details (ms)', Date.now() - it0)

  for (const layout of ['grid', 'masonry', 'timeline', 'list']) {
    await win.evaluate((l) => window.__setPrefs({ layout: l }), layout)
    await win.waitForTimeout(1200)
    const sweep = await scrollSweep(win, 5000)
    log(`rapid scroll ${layout}: avg/p95/max ms, DOM cells`, [sweep.avg, sweep.p95, sweep.max, sweep.maxDomCells])
    if (layout === 'timeline') await win.screenshot({ path: join(shots, '61-scale-timeline.png') })
  }
  await win.evaluate(() => window.__setPrefs({ layout: 'grid' }))
  // Viewer navigation latency
  await win.waitForTimeout(800)
  await win.evaluate((ids) => window.__openViewer(ids, 100), ids)
  await win.waitForTimeout(1000)
  const nav = await win.evaluate(() => new Promise((res) => {
    const times = []
    let i = 0
    const next = () => {
      const t = performance.now()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      const wait = () => {
        const img = document.querySelector('[data-viewer-root] img')
        if (img && img.complete) {
          times.push(performance.now() - t)
          if (++i < 20) setTimeout(next, 120)
          else res(times)
        } else requestAnimationFrame(wait)
      }
      requestAnimationFrame(wait)
    }
    next()
  }))
  nav.sort((a, b) => a - b)
  log('viewer next-photo latency median/max (ms)', [Math.round(nav[10]), Math.round(nav[nav.length - 1])])
  await win.keyboard.press('Escape')
  await win.waitForTimeout(500)
  log('memory after browsing (MB)', await metrics(app))
  await app.close()
}

writeFileSync(join(work, 'results.json'), JSON.stringify(results, null, 2))
console.log('\nresults written to', join(work, 'results.json'))
