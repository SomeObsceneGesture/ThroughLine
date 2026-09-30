import { useEffect, useState } from 'react'
import { FolderOpen, Plus, HardDrive, ShieldCheck, X, AlertTriangle, ChevronLeft, RefreshCw, Images } from 'lucide-react'
import { useApp } from '../store/app'
import { call, isMac } from '../lib/api'
import { Button, Spinner, TextInput } from '../components/ui/controls'
import { cx } from '../lib/cx'
import { fileName } from '../lib/format'

export function Welcome() {
  const launch = useApp((s) => s.launch)
  const [mode, setMode] = useState<'home' | 'create'>('home')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('Loupe Library')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void call('library.defaultLocation').then(setParent)
  }, [])

  const open = async (path?: string): Promise<void> => {
    setError(null)
    const dir = path ?? (await call('app.chooseDirectory', { title: 'Open Library', buttonLabel: 'Open Library' }))
    if (!dir) return
    setBusy(true)
    const r = await call('library.open', dir)
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'This library could not be opened.')
  }

  const create = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    const r = await call('library.create', parent, name.trim() || 'Loupe Library')
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'The library could not be created.')
    else useApp.setState({ justCreated: true })
  }

  const recent = (launch?.recent ?? []).filter((p) => p !== launch?.lastPath || !launch?.missing)

  return (
    <div className="h-full flex flex-col">
      <div className="drag-region h-12 shrink-0" />
      <div className="flex-1 flex items-center justify-center px-8 pb-12 overflow-auto">
        <div className="w-full max-w-[520px] anim-up">
          <div className="flex flex-col items-center text-center">
            <div className="relative h-16 w-16 mb-6">
              <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_45%,#000)] shadow-[0_12px_32px_color-mix(in_srgb,var(--accent)_40%,transparent)]" />
              <Images size={28} strokeWidth={1.6} className="absolute inset-0 m-auto text-white" />
            </div>
            <h1 className="text-[28px] font-bold tracking-[-0.03em]">Welcome to Loupe</h1>
            <p className="mt-2 text-[15px] text-fg-2">Your private photo &amp; video library.</p>
            <p className="mt-1 text-[13px] text-fg-3 flex items-center gap-1.5"><ShieldCheck size={14} /> Everything stays on your computer.</p>
          </div>

          {launch?.missing && launch.lastPath && mode === 'home' && (
            <div className="mt-8 p-4 rounded-xl bg-warning/10 border border-warning/25 flex gap-3">
              <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[13.5px]">Your library isn’t available</div>
                <div className="text-[12.5px] text-fg-2 mt-0.5 break-all">{launch.lastPath}</div>
                <div className="text-[12.5px] text-fg-2 mt-1">If it’s on an external drive, connect the drive and try again.</div>
                <Button size="sm" className="mt-3" icon={RefreshCw} onClick={() => void open(launch.lastPath!)}>Try Again</Button>
              </div>
            </div>
          )}

          {mode === 'home' ? (
            <div className="mt-10 grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('create')}
                className="group text-left p-5 rounded-2xl border border-line bg-raised hover:border-accent hover:shadow-[0_0_0_1px_var(--accent)] transition-all"
              >
                <div className="h-9 w-9 rounded-xl bg-accent text-accent-fg flex items-center justify-center mb-4"><Plus size={18} /></div>
                <div className="font-semibold text-[14px]">Create New Library</div>
                <div className="text-[12.5px] text-fg-2 mt-1 leading-relaxed">Start fresh. You’ll add photos by dragging them in.</div>
              </button>
              <button
                onClick={() => void open()}
                className="group text-left p-5 rounded-2xl border border-line bg-raised hover:border-line-strong hover:bg-hover transition-all"
              >
                <div className="h-9 w-9 rounded-xl bg-active text-fg-2 flex items-center justify-center mb-4"><FolderOpen size={18} /></div>
                <div className="font-semibold text-[14px]">Open Existing Library</div>
                <div className="text-[12.5px] text-fg-2 mt-1 leading-relaxed">Pick a Loupe library folder, on this computer or a drive.</div>
              </button>
            </div>
          ) : (
            <div className="mt-10 p-5 rounded-2xl border border-line bg-raised anim-pop">
              <button className="flex items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg mb-4" onClick={() => setMode('home')}>
                <ChevronLeft size={14} /> Back
              </button>
              <label className="block text-[12.5px] font-medium text-fg-2 mb-1.5" htmlFor="lib-name">Library name</label>
              <TextInput id="lib-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} data-autofocus autoFocus />
              <div className="block text-[12.5px] font-medium text-fg-2 mt-4 mb-1.5">Location</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 h-8 px-3 rounded-md bg-input border border-line flex items-center gap-2 text-[12.5px]">
                  <HardDrive size={14} className="text-fg-3 shrink-0" />
                  <span className="truncate" title={parent}>{parent}</span>
                </div>
                <Button
                  onClick={async () => {
                    const d = await call('app.chooseDirectory', { title: 'Choose where to keep your library', defaultPath: parent, buttonLabel: 'Choose' })
                    if (d) setParent(d)
                  }}
                >
                  Change…
                </Button>
              </div>
              <p className="text-[12px] text-fg-3 mt-3 leading-relaxed">
                A folder named “{name.trim() || 'Loupe Library'}” will be created {parent ? `in ${fileName(parent) || parent}` : ''}. It can live on an external drive. Photos you
                choose to copy in go into its Originals folder; everything else stays where it is.
              </p>
              <div className="flex justify-end mt-5">
                <Button variant="primary" size="lg" onClick={() => void create()} disabled={busy || !parent}>
                  {busy ? <Spinner size={14} /> : null} Create Library
                </Button>
              </div>
            </div>
          )}

          {error && <div className="mt-4 p-3 rounded-lg bg-danger/10 text-danger text-[12.5px]">{error}</div>}

          {mode === 'home' && recent.length > 0 && (
            <div className="mt-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3 mb-2 px-1">Recent Libraries</div>
              <div className="rounded-xl border border-line divide-y divide-[var(--line)] overflow-hidden">
                {recent.map((p) => (
                  <div key={p} className="group flex items-center gap-3 px-3.5 h-12 hover:bg-hover">
                    <button className="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => void open(p)}>
                      <HardDrive size={15} className="text-fg-3 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">{fileName(p)}</div>
                        <div className="text-[11.5px] text-fg-3 truncate">{p}</div>
                      </div>
                    </button>
                    <button
                      aria-label="Remove from list"
                      className={cx('h-7 w-7 rounded-md flex items-center justify-center text-fg-3 hover:text-fg hover:bg-active opacity-0 group-hover:opacity-100')}
                      onClick={() => {
                        void call('library.forgetRecent', p)
                        useApp.setState({ launch: launch ? { ...launch, recent: launch.recent.filter((r) => r !== p) } : launch })
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-10 text-center text-[11.5px] text-fg-3">
            Loupe never uploads your photos. No account, no internet connection required{isMac ? '' : ''}.
          </p>
        </div>
      </div>
    </div>
  )
}
