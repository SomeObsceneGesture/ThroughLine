import { useEffect, useMemo, useRef, useState } from 'react'
import { Repeat, FilePlus, FolderPlus, X, FolderOpen, CheckCircle2, AlertTriangle, Image as ImageIcon, Trash2, ArrowRight } from 'lucide-react'
import type { ConvertFormat, ConvertJobItem, ConvertOptions, ConvertProgress } from '@shared/types'
import { useApp } from '../store/app'
import { useUI, toast } from '../store/ui'
import { call, on, thumbUrl, isMac } from '../lib/api'
import { useDropTarget } from '../lib/dnd'
import { bytes, count, fileName, dirName } from '../lib/format'
import { extOf, formatLabel } from '@shared/formats'
import { Button, ProgressBar, Segmented, Select, Slider, Switch, TextInput } from '../components/ui/controls'
import { errorDialog } from '../components/dialogs/common'
import { cx } from '../lib/cx'

const FORMATS: { value: ConvertFormat; label: string }[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'tiff', label: 'TIFF' }
]

const FORMAT_NOTES: Record<ConvertFormat, string> = {
  jpeg: 'Best compatibility. Works everywhere.',
  png: 'Lossless, larger files. Keeps transparency.',
  webp: 'Smaller than JPEG at the same quality. Supported by modern apps and browsers.',
  avif: 'Smallest files, slower to create. Newer format.',
  tiff: 'Lossless, for printing and archiving. Large files.'
}

const ROW = 46

function ItemList({ items, onRemove }: { items: ConvertJobItem[]; onRemove: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [h, setH] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const start = Math.max(0, Math.floor(top / ROW) - 6)
  const end = Math.min(items.length, Math.ceil((top + h) / ROW) + 6)
  return (
    <div ref={ref} className="flex-1 overflow-y-auto scroll" onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div className="relative" style={{ height: items.length * ROW }}>
        {items.slice(start, end).map((it, k) => {
          const i = start + k
          return (
            <div key={`${it.path}:${i}`} className="group absolute left-3 right-3 flex items-center gap-3 px-2 rounded-lg hover:bg-hover" style={{ top: i * ROW, height: ROW - 4 }}>
              <div className="h-9 w-9 rounded-md bg-thumb overflow-hidden shrink-0">
                <img
                  src={it.mediaId ? thumbUrl(it.mediaId) : `loupe://ext/thumb?p=${encodeURIComponent(it.path)}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{fileName(it.path)}</div>
                <div className="text-[11.5px] text-fg-3 truncate">{dirName(it.path)}</div>
              </div>
              <span className="text-[11px] font-medium text-fg-3 px-1.5 h-5 rounded bg-hover flex items-center">{formatLabel(extOf(it.path))}</span>
              <button aria-label="Remove" className="h-7 w-7 rounded-md flex items-center justify-center text-fg-3 hover:text-fg hover:bg-active opacity-0 group-hover:opacity-100" onClick={() => onRemove(i)}>
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ConverterView() {
  const items = useUI((s) => s.converterItems)
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const opts = prefs.converter
  const meta = prefs.metadata
  const [job, setJob] = useState<ConvertProgress | null>(null)
  const [adding, setAdding] = useState(false)
  const setItems = (list: ConvertJobItem[]): void => useUI.setState({ converterItems: list })
  const setOpts = (patch: Partial<ConvertOptions>): void => setPrefs({ converter: { ...opts, ...patch } })

  useEffect(() => on('convert:progress', (p) => setJob((j) => (j && j.jobId !== p.jobId ? j : p))), [])

  const addPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setAdding(true)
    const expanded = await call('convert.expand', paths)
    setAdding(false)
    const seen = new Set(items.map((i) => i.path))
    const fresh = expanded.filter((i) => !seen.has(i.path))
    setItems([...items, ...fresh])
    if (!expanded.length) toast('No images found in what you dropped')
    else if (fresh.length < expanded.length) toast(`${count(expanded.length - fresh.length, 'image')} ${expanded.length - fresh.length === 1 ? 'was' : 'were'} already in the list`)
  }

  const drop = useDropTarget({
    onFiles: (paths) => void addPaths(paths),
    onMedia: async (ids) => {
      const list = await call('convert.fromMedia', ids)
      const seen = new Set(items.map((i) => i.path))
      setItems([...items, ...list.filter((i) => !seen.has(i.path))])
    }
  })

  const running = job && !job.finished
  const lossy = opts.format === 'jpeg' || opts.format === 'webp' || opts.format === 'avif'
  const sample = items[0]?.path
  const ext = opts.format === 'jpeg' ? 'jpg' : opts.format === 'tiff' ? 'tif' : opts.format
  const preview = useMemo(() => {
    if (!sample) return null
    const base = fileName(sample).replace(/\.[^.]+$/, '')
    const d = new Date()
    const name = (opts.naming || '{name}')
      .replace(/\{name\}/g, base)
      .replace(/\{n\}/g, '001')
      .replace(/\{date\}/g, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
      .replace(/\{format\}/g, opts.format)
    return { from: fileName(sample), to: `${name}.${ext}` }
  }, [sample, opts.naming, opts.format, ext])

  const destLabel = opts.destination === 'same' ? 'Next to each original' : opts.destination === 'subfolder' ? `A “${opts.subfolderName || 'Converted'}” folder next to each original` : opts.customDir ?? 'Choose a folder…'

  const start = async (): Promise<void> => {
    if (!items.length) return
    if (opts.destination === 'custom' && !opts.customDir) {
      const d = await call('app.chooseDirectory', { title: 'Save converted images to…', buttonLabel: 'Choose' })
      if (!d) return
      setOpts({ customDir: d })
      opts.customDir = d
    }
    setJob({ jobId: -1, done: 0, total: items.length, failed: 0, finished: false, cancelled: false, outputs: [], errors: [], outputBytes: 0, inputBytes: 0 })
    const jobId = await call('convert.start', items, { ...opts, keepMetadata: meta.preserveOnConvert, stripLocation: meta.stripLocationOnExport })
    setJob((j) => (j ? { ...j, jobId } : j))
  }

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col" {...drop.handlers}>
        {items.length === 0 ? (
          <div className="flex-1 p-8 flex">
            <div className={cx('flex-1 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center text-center transition-colors', drop.over ? 'border-accent bg-accent-soft' : 'border-line-strong')}>
              <div className="h-14 w-14 rounded-2xl bg-hover flex items-center justify-center text-fg-3 mb-5"><Repeat size={24} strokeWidth={1.6} /></div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Drop images here to convert them</h2>
              <p className="mt-2 text-[13.5px] text-fg-2 max-w-[440px] leading-relaxed">
                HEIC, RAW, PNG, TIFF, WEBP and more — one file or thousands, including whole folders. Your originals are never changed.
              </p>
              <div className="mt-6 flex gap-2.5">
                <Button icon={FilePlus} onClick={async () => void addPaths(await call('app.chooseFiles', { title: 'Choose images to convert', media: true }))}>Choose Files…</Button>
                <Button icon={FolderPlus} onClick={async () => void addPaths(await call('app.chooseFiles', { title: 'Choose a folder of images', directories: true }))}>Choose Folder…</Button>
              </div>
              <p className="mt-4 text-[12px] text-fg-3">You can also right-click photos in your library and choose Convert.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="h-12 shrink-0 flex items-center gap-2 px-5 border-b border-line">
              <span className="text-[13px] font-medium">{count(items.length, 'image')}</span>
              {adding && <span className="text-[12px] text-fg-3">Adding…</span>}
              <div className="flex-1" />
              <Button size="sm" variant="ghost" icon={FilePlus} disabled={!!running} onClick={async () => void addPaths(await call('app.chooseFiles', { title: 'Add images', media: true }))}>Add Files</Button>
              <Button size="sm" variant="ghost" icon={FolderPlus} disabled={!!running} onClick={async () => void addPaths(await call('app.chooseFiles', { title: 'Add a folder', directories: true }))}>Add Folder</Button>
              <Button size="sm" variant="ghost" icon={Trash2} disabled={!!running} onClick={() => { setItems([]); setJob(null) }}>Clear</Button>
            </div>
            <div className={cx('flex-1 min-h-0 flex flex-col transition-colors pt-2', drop.over && 'bg-accent-soft')}>
              <ItemList items={items} onRemove={(i) => setItems(items.filter((_, k) => k !== i))} />
            </div>
          </>
        )}
      </div>

      <aside className="w-[340px] shrink-0 border-l border-line flex flex-col min-h-0" aria-label="Conversion settings">
        <div className="flex-1 overflow-y-auto scroll p-5 space-y-6">
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Convert to</div>
            <Segmented value={opts.format} options={FORMATS} onChange={(v) => setOpts({ format: v })} className="w-full" size="sm" />
            <p className="text-[12px] text-fg-3 mt-2 leading-relaxed">{FORMAT_NOTES[opts.format]}</p>
          </div>
          {lossy && (
            <div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="font-semibold text-fg-2">Quality</span>
                <span className="tabular text-fg-2">{opts.quality}%</span>
              </div>
              <Slider value={opts.quality} min={30} max={100} step={1} onChange={(v) => setOpts({ quality: v })} label="Quality" />
              <div className="flex justify-between text-[11px] text-fg-3 mt-0.5"><span>Smaller file</span><span>Better quality</span></div>
            </div>
          )}
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Size</div>
            <div className="flex gap-2">
              <Select
                className="flex-1"
                value={opts.resize}
                options={[
                  { value: 'original', label: 'Original size' },
                  { value: 'long', label: 'Longest edge' },
                  { value: 'width', label: 'Width' },
                  { value: 'height', label: 'Height' },
                  { value: 'percent', label: 'Percentage' }
                ]}
                onChange={(v) => setOpts({ resize: v, resizeValue: v === 'percent' ? 50 : opts.resize === 'percent' || opts.resize === 'original' ? 2048 : opts.resizeValue })}
                label="Resize"
              />
              {opts.resize !== 'original' && (
                <div className="relative w-28">
                  <TextInput
                    type="number"
                    min={1}
                    value={opts.resizeValue}
                    onChange={(e) => setOpts({ resizeValue: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                    aria-label="Size value"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-fg-3 pointer-events-none">{opts.resize === 'percent' ? '%' : 'px'}</span>
                </div>
              )}
            </div>
            <p className="text-[12px] text-fg-3 mt-2">{opts.resize === 'original' ? 'Pixel dimensions stay the same.' : 'Aspect ratio is always kept. Images are never enlarged beyond their original size (except by percentage).'}</p>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">File names</div>
            <TextInput value={opts.naming} onChange={(e) => setOpts({ naming: e.target.value })} placeholder="{name}" aria-label="Naming pattern" />
            <div className="flex gap-1.5 mt-2">
              {['{name}', '{n}', '{date}'].map((t) => (
                <button key={t} className="h-6 px-2 rounded-md bg-hover hover:bg-active text-[11.5px] font-mono" onClick={() => setOpts({ naming: `${opts.naming}${opts.naming && !opts.naming.endsWith(' ') && !opts.naming.endsWith('-') && !opts.naming.endsWith('_') ? '-' : ''}${t}` })}>
                  {t}
                </button>
              ))}
            </div>
            {preview && (
              <div className="mt-2 text-[11.5px] text-fg-3 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{preview.from}</span>
                <ArrowRight size={11} className="shrink-0" />
                <span className="truncate text-fg-2">{preview.to}</span>
              </div>
            )}
            <p className="text-[11.5px] text-fg-3 mt-1.5">Existing files are never overwritten — a number is added instead.</p>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-fg-2 mb-2">Save to</div>
            <Segmented
              size="sm"
              className="w-full"
              value={opts.destination}
              options={[{ value: 'subfolder', label: 'Subfolder' }, { value: 'same', label: 'Same folder' }, { value: 'custom', label: 'Choose…' }]}
              onChange={async (v) => {
                if (v === 'custom') {
                  const d = await call('app.chooseDirectory', { title: 'Save converted images to…', buttonLabel: 'Choose', defaultPath: opts.customDir ?? undefined })
                  if (d) setOpts({ destination: 'custom', customDir: d })
                } else setOpts({ destination: v })
              }}
            />
            <p className="text-[12px] text-fg-3 mt-2 break-all">{destLabel}</p>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-[12.5px]">
              <span>Preserve metadata<span className="block text-[11.5px] text-fg-3">Date, camera and other EXIF details</span></span>
              <Switch checked={meta.preserveOnConvert} onChange={(v) => setPrefs({ metadata: { ...meta, preserveOnConvert: v } })} label="Preserve metadata" />
            </label>
            <label className="flex items-center justify-between gap-3 text-[12.5px]">
              <span>Remove location<span className="block text-[11.5px] text-fg-3">Strip GPS coordinates</span></span>
              <Switch checked={meta.stripLocationOnExport} onChange={(v) => setPrefs({ metadata: { ...meta, stripLocationOnExport: v } })} label="Remove location" />
            </label>
            <label className="flex items-center justify-between gap-3 text-[12.5px]">
              <span>Add converted images to library</span>
              <Switch checked={opts.addToLibrary} onChange={(v) => setOpts({ addToLibrary: v })} label="Add to library" />
            </label>
          </div>
        </div>
        <div className="p-4 border-t border-line">
          {job && (
            <div className="mb-3">
              {!job.finished ? (
                <>
                  <div className="flex justify-between text-[12px] mb-1.5">
                    <span className="truncate text-fg-2">{job.current ? `Converting ${job.current}` : 'Starting…'}</span>
                    <span className="tabular text-fg-3 shrink-0 ml-2">{job.done} / {job.total}</span>
                  </div>
                  <ProgressBar value={job.total ? job.done / job.total : 0} />
                </>
              ) : (
                <div className="rounded-lg bg-hover p-3 text-[12.5px]">
                  <div className="flex items-center gap-2 font-medium">
                    {job.failed ? <AlertTriangle size={15} className="text-warning" /> : <CheckCircle2 size={15} className="text-success" />}
                    {job.cancelled ? 'Stopped' : 'Done'} — converted {count(job.outputs.length, 'image')}
                  </div>
                  <div className="text-fg-3 mt-1 tabular">
                    {bytes(job.inputBytes)} → {bytes(job.outputBytes)}
                    {job.failed ? ` · ${job.failed} failed` : ''}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {job.outputs[0] && (
                      <Button size="sm" icon={FolderOpen} onClick={() => void call('app.showItemInFolder', job.outputs[0])}>{isMac ? 'Show in Finder' : 'Show in Folder'}</Button>
                    )}
                    {job.errors.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => errorDialog({ title: `${count(job.errors.length, 'image')} couldn’t be converted`, message: 'The others were converted successfully.', details: job.errors.map((e) => `${e.path}\n  ${e.reason}`).join('\n') })}>
                        Details
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {running ? (
            <Button className="w-full" size="lg" onClick={() => job && void call('convert.cancel', job.jobId)}>Stop</Button>
          ) : (
            <Button className="w-full" size="lg" variant="primary" icon={ImageIcon} disabled={!items.length} onClick={() => void start()}>
              {items.length ? `Convert ${count(items.length, 'Image')}` : 'Add images to convert'}
            </Button>
          )}
        </div>
      </aside>
    </div>
  )
}
