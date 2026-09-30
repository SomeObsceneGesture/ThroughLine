import { useEffect, useState, type ReactNode } from 'react'
import { HardDrive, Palette, Gauge, Eye, FileText, Keyboard, LifeBuoy, Info, FolderOpen, RefreshCw, Trash2, Download, Upload, Check, ShieldCheck } from 'lucide-react'
import type { LibraryStats } from '@shared/types'
import { useApp } from '../store/app'
import { call, isMac } from '../lib/api'
import { bytes, count, dateTime } from '../lib/format'
import { ACCENTS, accentColor } from '../lib/theme'
import { SHORTCUTS } from '../lib/shortcuts'
import { Button, Kbd, Segmented, Select, Slider, Switch } from '../components/ui/controls'
import { confirmDialog, errorDialog } from '../components/dialogs/common'
import { toast } from '../store/ui'
import * as actions from '../lib/actions'
import { cx } from '../lib/cx'

const SECTIONS = [
  { id: 'library', label: 'Library', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'viewer', label: 'Viewer', icon: Eye },
  { id: 'metadata', label: 'Metadata', icon: FileText },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'backup', label: 'Backup & Recovery', icon: LifeBuoy },
  { id: 'about', label: 'About', icon: Info }
]

function Group({ title, children, description }: { title?: string; children: ReactNode; description?: ReactNode }) {
  return (
    <section className="mb-8">
      {title && <h3 className="text-[13px] font-semibold mb-1">{title}</h3>}
      {description && <p className="text-[12.5px] text-fg-2 mb-3 leading-relaxed max-w-[620px]">{description}</p>}
      <div className="rounded-xl border border-line bg-raised divide-y divide-[var(--line)]">{children}</div>
    </section>
  )
}

function Row({ label, description, children, align = 'center' }: { label: ReactNode; description?: ReactNode; children?: ReactNode; align?: 'center' | 'start' }) {
  return (
    <div className={cx('flex gap-6 px-4 py-3', align === 'center' ? 'items-center' : 'items-start')}>
      <div className="flex-1 min-w-0">
        <div className="text-[13px]">{label}</div>
        {description && <div className="text-[12px] text-fg-3 mt-0.5 leading-relaxed">{description}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11.5px] text-fg-3">{label}</div>
      <div className="text-[15px] font-semibold tabular mt-0.5">{value}</div>
      {sub && <div className="text-[11.5px] text-fg-3 tabular">{sub}</div>}
    </div>
  )
}

function LibrarySection() {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const library = useApp((s) => s.library)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  useEffect(() => {
    void call('library.stats').then(setStats)
  }, [])
  return (
    <>
      <Group title="Location" description="Your library is an ordinary folder. Its Database holds albums, tags and metadata; Originals holds files you chose to copy in. Everything else is regenerated as needed.">
        <Row label={<span className="font-medium">{library?.name}</span>} description={<span className="break-all select-text">{library?.path}</span>}>
          <Button size="sm" icon={FolderOpen} onClick={() => library && void call('app.openPath', library.path)}>{isMac ? 'Show in Finder' : 'Open Folder'}</Button>
        </Row>
        <Row label="Switch libraries" description="Libraries on external drives work too. The last library you used opens automatically.">
          <Button size="sm" onClick={() => void actions.openLibraryDialog()}>Open Library…</Button>
          <Button size="sm" onClick={() => void actions.newLibraryDialog()}>New Library…</Button>
        </Row>
      </Group>
      {stats && (
        <Group title="Contents">
          <div className="grid grid-cols-3 divide-x divide-[var(--line)]">
            <Stat label="Photos" value={stats.photos.toLocaleString()} />
            <Stat label="Videos" value={stats.videos.toLocaleString()} />
            <Stat label="Last import" value={stats.lastImport ? dateTime(stats.lastImport) : '—'} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-[var(--line)]">
            <Stat label="Stored in library" value={bytes(stats.originalsBytes)} sub={count(stats.copiedCount, 'file')} />
            <Stat label="Kept in original locations" value={bytes(stats.referencedBytes)} sub={count(stats.referencedCount, 'file')} />
            <Stat label="Database" value={bytes(stats.databaseBytes)} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-[var(--line)]">
            <Stat label="Thumbnails" value={bytes(stats.thumbnailsBytes)} />
            <Stat label="Previews" value={bytes(stats.previewsBytes)} />
            <Stat label="Cache" value={bytes(stats.cacheBytes)} />
          </div>
        </Group>
      )}
      <Group title="Importing">
        <Row label="When adding media" description="Copying keeps a complete, self-contained library. Keeping files in place uses no extra space.">
          <Segmented
            size="sm"
            value={prefs.importMode}
            options={[{ value: 'ask', label: 'Ask each time' }, { value: 'copy', label: 'Copy' }, { value: 'reference', label: 'Keep in place' }]}
            onChange={(v) => setPrefs({ importMode: v })}
          />
        </Row>
        <Row label="Organize copied files" description="How files copied into Originals are arranged.">
          <Segmented size="sm" value={prefs.copyOrganization} options={[{ value: 'structure', label: 'Keep folder structure' }, { value: 'date', label: 'By date' }]} onChange={(v) => setPrefs({ copyOrganization: v })} />
        </Row>
        <Row label="Duplicate files" description="Detected by file contents, not by name. Skipped files are listed after each import.">
          <Segmented size="sm" value={prefs.duplicateHandling} options={[{ value: 'skip', label: 'Skip duplicates' }, { value: 'import', label: 'Import anyway' }]} onChange={(v) => setPrefs({ duplicateHandling: v })} />
        </Row>
        <Row label="Check referenced folders for new files on launch" description="Picks up photos added to folders you imported with “Keep in current location”.">
          <Switch checked={prefs.rescanOnLaunch} onChange={(v) => setPrefs({ rescanOnLaunch: v })} label="Rescan on launch" />
        </Row>
      </Group>
      <Group title="Thumbnails & Previews">
        <Row label="Rebuild all thumbnails" description="Regenerates every thumbnail in the background. Useful after changing thumbnail quality.">
          <Button
            size="sm"
            icon={RefreshCw}
            onClick={async () => {
              if (await confirmDialog({ title: 'Rebuild all thumbnails?', message: 'This runs in the background; you can keep browsing.', confirmLabel: 'Rebuild' })) {
                const n = await call('cache.rebuildThumbnails')
                toast(`Rebuilding ${count(n, 'thumbnail')}…`)
              }
            }}
          >
            Rebuild
          </Button>
        </Row>
        <Row label="Clear preview cache" description="Removes generated full-screen previews and video scrub strips. They’re recreated when needed.">
          <Button
            size="sm"
            icon={Trash2}
            onClick={async () => {
              await call('cache.clearPreviews')
              setStats(await call('library.stats'))
              toast('Preview cache cleared')
            }}
          >
            Clear
          </Button>
        </Row>
      </Group>
    </>
  )
}

function AppearanceSection() {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const dark = document.documentElement.dataset.theme === 'dark'
  return (
    <>
      <Group title="Theme">
        <Row label="Appearance">
          <Segmented value={prefs.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(v) => setPrefs({ theme: v })} />
        </Row>
        <Row label="Accent color">
          <div className="flex gap-2" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                role="radio"
                aria-checked={prefs.accent === a.key}
                aria-label={a.label}
                title={a.label}
                onClick={() => setPrefs({ accent: a.key })}
                className={cx('h-6 w-6 rounded-full flex items-center justify-center transition-transform hover:scale-110', prefs.accent === a.key && 'ring-2 ring-offset-2 ring-offset-[var(--raised)]')}
                style={{ background: accentColor(a.key, dark), ['--tw-ring-color' as string]: accentColor(a.key, dark) }}
              >
                {prefs.accent === a.key && <Check size={13} strokeWidth={3} className="text-white" />}
              </button>
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Gallery">
        <Row label="Density">
          <Segmented size="sm" value={prefs.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }]} onChange={(v) => setPrefs({ density: v })} />
        </Row>
        <Row label="Thumbnail size" description={`${prefs.thumbSize} px`}>
          <div className="w-52"><Slider value={prefs.thumbSize} min={96} max={420} step={2} onChange={(v) => setPrefs({ thumbSize: v })} label="Thumbnail size" /></div>
        </Row>
        <Row label="Crop thumbnails to squares" description="Off shows each photo’s full frame in the grid.">
          <Switch checked={prefs.squareThumbs} onChange={(v) => setPrefs({ squareThumbs: v })} label="Crop to squares" />
        </Row>
        <Row label="Sidebar width" description={`${prefs.sidebarWidth} px — drag the sidebar edge to resize.`}>
          <Button size="sm" onClick={() => setPrefs({ sidebarWidth: 232 })}>Reset</Button>
          <Switch checked={!prefs.sidebarCollapsed} onChange={(v) => setPrefs({ sidebarCollapsed: !v })} label="Show sidebar" />
        </Row>
      </Group>
    </>
  )
}

function PerformanceSection() {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const [hwChanged, setHwChanged] = useState(false)
  const cores = navigator.hardwareConcurrency || 4
  return (
    <Group title="Background Processing" description="Thumbnails, metadata and conversions run in background workers so browsing stays smooth, even while a large import is running.">
      <Row label="Worker threads" description={`Auto uses ${Math.max(2, Math.min(6, cores - 1))} of your ${cores} cores.`}>
        <Select
          value={prefs.workerThreads}
          options={[{ value: 0, label: 'Automatic' }, ...[1, 2, 3, 4, 6, 8, 12].filter((n) => n <= Math.max(cores, 2)).map((n) => ({ value: n, label: String(n) }))]}
          onChange={(v) => setPrefs({ workerThreads: v })}
          label="Worker threads"
        />
      </Row>
      <Row label="Thumbnail quality" description="High looks sharper on large or high-DPI displays and uses about twice the disk space. Applies to new thumbnails.">
        <Segmented size="sm" value={prefs.thumbnailQuality} options={[{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} onChange={(v) => setPrefs({ thumbnailQuality: v })} />
      </Row>
      <Row label="Preview cache limit" description="Space for full-screen previews of HEIC, RAW and TIFF files. Oldest previews are removed first.">
        <Select
          value={prefs.previewCacheMB}
          options={[512, 1024, 2048, 4096, 8192, 16384].map((n) => ({ value: n, label: n >= 1024 ? `${n / 1024} GB` : `${n} MB` }))}
          onChange={(v) => setPrefs({ previewCacheMB: v })}
          label="Preview cache limit"
        />
      </Row>
      <Row label="Hardware acceleration" description="Uses the graphics card for smoother scrolling and video. Turn off only if you see display glitches.">
        {hwChanged && <Button size="sm" variant="primary" onClick={() => void call('app.relaunch')}>Restart Now</Button>}
        <Switch
          checked={prefs.hardwareAcceleration}
          onChange={(v) => {
            setPrefs({ hardwareAcceleration: v })
            setHwChanged(true)
          }}
          label="Hardware acceleration"
        />
      </Row>
    </Group>
  )
}

function ViewerSection() {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const v = prefs.viewer
  const set = (patch: Partial<typeof v>): void => setPrefs({ viewer: { ...v, ...patch } })
  return (
    <>
      <Group title="Photos">
        <Row label="Default zoom" description="Fit shows the whole photo. Small photos are never enlarged beyond 100% when fitting.">
          <Segmented size="sm" value={v.defaultZoom} options={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }, { value: 'actual', label: 'Actual size' }]} onChange={(x) => set({ defaultZoom: x })} />
        </Row>
        <Row label="Background">
          <Segmented size="sm" value={v.background} options={[{ value: 'black', label: 'Black' }, { value: 'dark', label: 'Dark gray' }, { value: 'theme', label: 'Match theme' }]} onChange={(x) => set({ background: x })} />
        </Row>
        <Row label="Filmstrip" description="Small thumbnails at the bottom of the viewer.">
          <Switch checked={v.showFilmstrip} onChange={(x) => set({ showFilmstrip: x })} label="Show filmstrip" />
        </Row>
      </Group>
      <Group title="Slideshow">
        <Row label="Time per photo" description={`${v.slideshowSeconds} seconds`}>
          <div className="w-44"><Slider value={v.slideshowSeconds} min={2} max={15} step={1} onChange={(x) => set({ slideshowSeconds: x })} label="Seconds per photo" /></div>
        </Row>
        <Row label="Transition">
          <Segmented size="sm" value={v.slideshowTransition} options={[{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }]} onChange={(x) => set({ slideshowTransition: x })} />
        </Row>
      </Group>
      <Group title="Videos">
        <Row label="Play videos automatically">
          <Switch checked={v.autoplayVideo} onChange={(x) => set({ autoplayVideo: x })} label="Autoplay" />
        </Row>
        <Row label="Loop videos">
          <Switch checked={v.loopVideo} onChange={(x) => set({ loopVideo: x })} label="Loop" />
        </Row>
      </Group>
    </>
  )
}

function MetadataSection() {
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const m = prefs.metadata
  const set = (patch: Partial<typeof m>): void => setPrefs({ metadata: { ...m, ...patch } })
  return (
    <>
      <Group title="Dates">
        <Row label="Use the capture date from photo metadata" description="Sorts by when a photo was taken (EXIF), falling back to the file’s modified date. Applies to newly processed items.">
          <Switch checked={m.preferExifDate} onChange={(x) => set({ preferExifDate: x })} label="Prefer EXIF date" />
        </Row>
      </Group>
      <Group title="Conversion & Export" description="Loupe never writes to your original files. These options apply to new files created by the converter and collage export.">
        <Row label="Preserve metadata" description="Keep camera, date and other EXIF details in converted images.">
          <Switch checked={m.preserveOnConvert} onChange={(x) => set({ preserveOnConvert: x })} label="Preserve metadata" />
        </Row>
        <Row label="Remove location information" description="Strip GPS coordinates from converted images — useful before sharing.">
          <Switch checked={m.stripLocationOnExport} onChange={(x) => set({ stripLocationOnExport: x })} label="Remove location" />
        </Row>
      </Group>
      <Group title="File Naming">
        <Row label="Names for files copied into the library" description="“Date & time” renames copies like 2026-07-04 09.30.00.jpg. Originals are never renamed.">
          <Segmented size="sm" value={m.copyNaming} options={[{ value: 'original', label: 'Keep original' }, { value: 'date', label: 'Date & time' }]} onChange={(x) => set({ copyNaming: x })} />
        </Row>
      </Group>
    </>
  )
}

function ShortcutsSection() {
  return (
    <div className="grid grid-cols-2 gap-6">
      {SHORTCUTS.map((g) => (
        <Group key={g.group} title={g.group}>
          {g.items.map(([k, v]) => (
            <div key={v} className="flex items-center justify-between gap-4 px-4 py-2 text-[12.5px]">
              <span className="text-fg-2">{v}</span>
              <span className="flex gap-1 shrink-0">{k.split(' ').filter(Boolean).map((p, i) => <Kbd key={i}>{p}</Kbd>)}</span>
            </div>
          ))}
        </Group>
      ))}
    </div>
  )
}

function BackupSection() {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="mb-6 p-4 rounded-xl bg-accent-soft flex gap-3 max-w-[680px]">
        <ShieldCheck size={18} className="text-accent shrink-0 mt-0.5" />
        <div className="text-[12.5px] leading-relaxed">
          <div className="font-semibold text-[13px] mb-1">A library backup is not a photo backup</div>
          A backup file saves your library’s <b>organisation</b> — albums, tags, favorites, ratings, metadata and settings. It does <b>not</b> contain your photos or videos.
          To protect the photos themselves, copy your library’s <b>Originals</b> folder, plus any folders you imported with “Keep in current location”, to another drive.
        </div>
      </div>
      <Group title="Back Up">
        <Row label="Back up library organisation" description="Saves a single .loupebackup file (usually a few megabytes).">
          <Button
            size="sm"
            icon={Download}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await call('backup.create')
                if (r) toast('Backup saved', { kind: 'success', detail: r.path, action: { label: 'Show', run: () => void call('app.showItemInFolder', r.path) } })
              } catch (err) {
                errorDialog({ title: 'The backup couldn’t be saved', message: (err as Error).message })
              }
              setBusy(false)
            }}
          >
            Back Up…
          </Button>
        </Row>
      </Group>
      <Group title="Restore">
        <Row label="Restore from a backup" description="Replaces this library’s albums, tags and metadata with the backup’s. The current database is kept alongside as a safety copy.">
          <Button
            size="sm"
            icon={Upload}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Restore from a backup?',
                message: 'Albums, tags, favorites and metadata in this library will be replaced by the backup’s. Photos and videos on disk are not touched. A copy of the current database is kept in the library’s Database folder.',
                confirmLabel: 'Choose Backup…'
              })
              if (!ok) return
              const r = await call('backup.restore')
              if (r && !r.ok) errorDialog({ title: 'Couldn’t restore this backup', message: r.error ?? '' })
              else if (r?.ok) toast('Library restored from backup', { kind: 'success' })
            }}
          >
            Restore…
          </Button>
        </Row>
      </Group>
    </>
  )
}

function AboutSection() {
  const info = useApp((s) => s.info)
  return (
    <Group>
      <Row label="Loupe" description="A private, local-first photo & video library.">
        <span className="text-[12.5px] text-fg-2 tabular">Version {info?.version}</span>
      </Row>
      <Row label="Privacy" description="Loupe works entirely offline. It has no accounts, no analytics and never uploads your photos or videos anywhere." />
      <Row label="Video support" description={info?.ffmpeg ? 'Built-in video tools are available: thumbnails, metadata, scrub previews and playback of formats like AVI and HEVC.' : 'Video tools were not found; videos can still be played if their format is supported natively.'}>
        <span className={cx('text-[12px] font-medium', info?.ffmpeg ? 'text-success' : 'text-warning')}>{info?.ffmpeg ? 'Available' : 'Limited'}</span>
      </Row>
      <Row label="App data" description={<span className="break-all select-text">{info?.userData}</span>}>
        <Button size="sm" onClick={() => info && void call('app.openPath', info.userData)}>Open</Button>
      </Row>
      <Row label="Runtime" description={`Electron ${info?.electron} · ${info?.platform}`} />
    </Group>
  )
}

export function SettingsView({ section }: { section?: string }) {
  const [active, setActive] = useState(section ?? 'library')
  useEffect(() => {
    if (section) setActive(section)
  }, [section])
  return (
    <div className="flex-1 flex min-h-0">
      <nav className="w-[210px] shrink-0 border-r border-line py-4 px-2 space-y-px" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            aria-current={active === s.id ? 'page' : undefined}
            className={cx('w-full h-8 px-2.5 rounded-md flex items-center gap-2.5 text-[13px] text-left', active === s.id ? 'bg-active text-fg font-medium' : 'text-fg-2 hover:bg-hover hover:text-fg')}
          >
            <s.icon size={15} className={active === s.id ? 'text-accent' : 'text-fg-3'} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto scroll">
        <div className="max-w-[820px] px-10 py-8">
          <h2 className="text-[20px] font-bold tracking-[-0.02em] mb-6">{SECTIONS.find((s) => s.id === active)?.label}</h2>
          {active === 'library' && <LibrarySection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'performance' && <PerformanceSection />}
          {active === 'viewer' && <ViewerSection />}
          {active === 'metadata' && <MetadataSection />}
          {active === 'shortcuts' && <ShortcutsSection />}
          {active === 'backup' && <BackupSection />}
          {active === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  )
}
