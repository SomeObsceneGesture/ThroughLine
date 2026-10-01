// Renderer memory under heavy scrolling, measured without Playwright.
// Playwright enables the DevTools Network domain, which keeps every response
// body (all thumbnails) alive in the renderer and inflates memory several-fold.
// This probe drives the app over a bare CDP socket using only Runtime.evaluate.
//
// Usage: xvfb-run -a node tests/e2e/memory.mjs   (after scale.mjs has built test-data/scale-run)
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const work = resolve(process.env.SCALE_WORK ?? 'test-data/scale-run')
const port = 9339
const child = spawn(resolve('node_modules/electron/dist/electron'), ['--no-sandbox', `--remote-debugging-port=${port}`, resolve('out/main/index.js')], {
  env: { ...process.env, LOUPE_USER_DATA: join(work, 'userdata') },
  stdio: 'ignore'
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error('no page target')
}

const ws = new WebSocket(await pageSocket())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const waiting = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg)
    waiting.delete(msg.id)
  }
})
async function evaluate(expression) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const msg = await new Promise((r) => waiting.set(id, r))
  if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  return msg.result?.result?.value
}

function rendererPid() {
  const parent = (pid) => +readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue
    try {
      if (!readFileSync(`/proc/${d}/cmdline`, 'utf8').includes('--type=renderer')) continue
      for (let p = +d, hops = 0; hops < 4 && p > 1; hops++) {
        p = parent(p)
        if (p === child.pid) return +d
      }
    } catch { /* process went away */ }
  }
  return 0
}
function mem(pid) {
  const st = readFileSync(`/proc/${pid}/status`, 'utf8')
  const mb = (k) => Math.round(+(st.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0) / 1024)
  return { rss: mb('VmRSS'), anon: mb('RssAnon'), shmem: mb('RssShmem') }
}

// Chromium memory-infra dump (per-allocator sizes) for the renderer, via the browser target.
async function allocatorDump(pid) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const bws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((r) => bws.addEventListener('open', r, { once: true }))
  let n = 0
  const events = []
  const pending = new Map()
  let complete
  const done = new Promise((r) => (complete = r))
  bws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Tracing.dataCollected') events.push(...m.params.value)
    else if (m.method === 'Tracing.tracingComplete') complete()
    else if (m.id && pending.has(m.id)) pending.get(m.id)(m)
  })
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); bws.send(JSON.stringify({ id, method, params })) })
  const started = await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } } })
  if (started.error) throw new Error(`Tracing.start: ${started.error.message}`)
  await sleep(500)
  const dumped = await send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' })
  if (dumped.error || !dumped.result?.success) throw new Error(`memory dump failed: ${dumped.error?.message ?? 'unsuccessful'}`)
  const ended = await send('Tracing.end')
  if (ended.error) throw new Error(`Tracing.end: ${ended.error.message}`)
  await Promise.race([done, sleep(20000)])
  bws.close()
  const dumps = events.filter((e) => e.ph === 'v' && e.pid === pid)
  const alloc = dumps.filter((e) => e.args?.dumps?.allocators).at(-1)?.args.dumps.allocators ?? {}
  const mb = (k) => { const a = alloc[k]?.attrs?.size; return a ? Math.round(parseInt(a.value, 16) / 1048576) : 0 }
  const keys = ['blink_gc', 'partition_alloc/partitions/buffer', 'partition_alloc/partitions/fast_malloc', 'partition_alloc/partitions/layout', 'partition_alloc/partitions/array_buffer', 'v8', 'malloc', 'cc/image_memory', 'cc/tile_memory', 'web_cache', 'discardable', 'shared_memory', 'skia', 'font_caches']
  const out = Object.fromEntries(keys.map((k) => [k, mb(k)]).filter(([, v]) => v))
  const heap = alloc['blink_gc/main/heap']?.attrs
  if (heap?.allocated_objects_size) out['blink_gc live objects'] = Math.round(parseInt(heap.allocated_objects_size.value, 16) / 1048576)
  return out
}

const sweep = (ms) =>
  evaluate(`new Promise((res) => {
    const el = document.querySelector('[data-gallery-scroller]')
    const s = performance.now()
    const step = (t) => {
      const p = (t - s) / ${ms}
      el.scrollTop = (el.scrollHeight - el.clientHeight) * (p < 0.5 ? p * 2 : 2 - p * 2)
      if (t - s < ${ms}) requestAnimationFrame(step); else res(true)
    }
    requestAnimationFrame(step)
  })`)

try {
  for (let i = 0; i < 300; i++) {
    if (await evaluate(`!!document.querySelector('[data-media-id] img.loaded')`)) break
    await sleep(200)
  }
  await sleep(1500)
  const pid = rendererPid()
  if (!pid) throw new Error('renderer process not found')
  const out = { start: mem(pid) }
  for (const layout of ['grid', 'masonry', 'timeline', 'list', 'grid']) {
    await evaluate(`window.__setPrefs({ layout: '${layout}' }), true`)
    await sleep(1200)
    await sweep(5000)
    await sleep(1000)
    out[`after ${layout}`] = mem(pid)
  }
  await sleep(6000)
  out['idle 6s'] = mem(pid)
  if (process.env.TRACE) out.allocators = await allocatorDump(pid)
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(16), JSON.stringify(v))
} finally {
  ws.close()
  child.kill()
}
