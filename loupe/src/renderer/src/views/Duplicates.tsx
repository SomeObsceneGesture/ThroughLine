import { useEffect, useRef, useState } from 'react'
import { Copy, ScanSearch, Check, Trash2, Columns2, HardDrive, Link2, CheckCircle2, Info } from 'lucide-react'
import type { DuplicateGroup, DuplicateScanResult, MediaItem } from '@shared/types'
import { call, thumbUrl } from '../lib/api'
import { useApp } from '../store/app'
import { useUI, toast } from '../store/ui'
import { bytes, count, dateTime, resolution } from '../lib/format'
import { needsPreview } from '@shared/formats'
import { Button, Modal, Segmented, Spinner, Switch } from '../components/ui/controls'
import { DialogHeader } from '../components/dialogs/common'
import { confirmDialog } from '../components/dialogs/common'
import * as actions from '../lib/actions'
import { cx } from '../lib/cx'

const STRICTNESS = { strict: 3, balanced: 6, loose: 10 } as const

function Compare({ group, keep, onKeep, onClose }: { group: DuplicateGroup; keep: number; onKeep: (id: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 })
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null)
  const items = group.items.slice(0, 4)
  const url = (m: MediaItem): string => (m.kind === 'photo' && needsPreview(m.ext) ? `loupe://preview/${m.id}` : m.kind === 'photo' ? `loupe://media/${m.id}` : thumbUrl(m.id, m.thumbVersion))
  return (
    <Modal onClose={onClose} width={Math.min(window.innerWidth - 60, 1320)} className="h-[86vh]" labelledBy="dialog-title">
      <DialogHeader title="Compare" subtitle="Scroll to zoom, drag to pan — all images move together. Click “Keep this one” on the best copy." />
      <div
        className="flex-1 min-h-0 grid gap-3 px-6 pb-2"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        onWheel={(e) => setZoom((z) => ({ ...z, s: Math.max(1, Math.min(8, z.s * Math.exp(-e.deltaY * 0.002))) }))}
        onMouseDown={(e) => (drag.current = { sx: e.clientX, sy: e.clientY, x: zoom.x, y: zoom.y })}
        onMouseMove={(e) => {
          if (!drag.current) return
          setZoom((z) => ({ ...z, x: drag.current!.x + (e.clientX - drag.current!.sx) / z.s, y: drag.current!.y + (e.clientY - drag.current!.sy) / z.s }))
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {items.map((m) => (
          <div key={m.id} className={cx('flex flex-col min-h-0 rounded-xl border overflow-hidden', m.id === keep ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-line')}>
            <div className="flex-1 min-h-0 bg-black overflow-hidden flex items-center justify-center cursor-grab">
              <img src={url(m)} alt={m.filename} draggable={false} className="max-w-full max-h-full" style={{ transform: `scale(${zoom.s}) translate(${zoom.x}px, ${zoom.y}px) rotate(${m.rotation}deg)` }} />
            </div>
            <div className="p-3 text-[12px] space-y-0.5">
              <div className="font-medium truncate">{m.filename}</div>
              <div className="text-fg-3 tabular">{resolution(m.width, m.height, m.rotation)} · {bytes(m.size)}</div>
              <div className="text-fg-3">{dateTime(m.sortDate)}</div>
              <div className="text-fg-3 truncate" title={m.path}>{m.path}</div>
              <Button size="sm" className="mt-2 w-full" variant={m.id === keep ? 'primary' : 'secondary'} icon={m.id === keep ? Check : undefined} onClick={() => onKeep(m.id)}>
                {m.id === keep ? 'Keeping this one' : 'Keep this one'}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="px-6 py-4 flex justify-end">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

function GroupCard({ group, keep, setKeep, onResolved }: { group: DuplicateGroup; keep: number; setKeep: (id: number) => void; onResolved: () => void }) {
  const others = group.items.filter((m) => m.id !== keep)
  const saving = others.reduce((n, m) => n + m.size, 0)
  return (
    <div className="rounded-2xl border border-line bg-raised p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={cx('h-5 px-2 rounded-full text-[11px] font-semibold flex items-center', group.kind === 'exact' ? 'bg-accent-soft text-accent' : 'bg-warning/15 text-warning')}>
          {group.kind === 'exact' ? 'Identical files' : 'Look alike'}
        </span>
        <span className="text-[12.5px] text-fg-2">{count(group.items.length, 'file')}</span>
        <span className="text-[12px] text-fg-3">· removing extras frees {bytes(saving)}</span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={Columns2}
          onClick={() => useUI.getState().openDialog((close) => <Compare group={group} keep={keep} onKeep={setKeep} onClose={close} />)}
        >
          Compare
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await call('duplicates.ignore', group.items.map((m) => m.id))
            onResolved()
            toast('Kept all — this group won’t be suggested again')
          }}
        >
          Keep All
        </Button>
        <Button
          size="sm"
          icon={Trash2}
          onClick={async () => {
            await call('media.trash', others.map((m) => m.id))
            onResolved()
            toast(`Moved ${count(others.length, 'duplicate')} to Recently Deleted`, { action: { label: 'Undo', run: () => void actions.undo() } })
          }}
        >
          Remove Others
        </Button>
      </div>
      <div className="flex gap-3 overflow-x-auto scroll pb-1">
        {group.items.map((m) => {
          const k = m.id === keep
          return (
            <button key={m.id} onClick={() => setKeep(m.id)} className="w-[190px] shrink-0 text-left group" aria-pressed={k} aria-label={`Keep ${m.filename}`}>
              <div className={cx('relative aspect-[4/3] rounded-lg overflow-hidden bg-thumb transition-shadow', k ? 'shadow-[0_0_0_3px_var(--accent)]' : 'group-hover:shadow-[0_0_0_2px_var(--line-strong)]')}>
                <img src={thumbUrl(m.id, m.thumbVersion)} alt="" className="h-full w-full object-cover" style={{ transform: m.rotation ? `rotate(${m.rotation}deg)` : undefined }} />
                <span className={cx('absolute top-1.5 left-1.5 h-5 px-2 rounded-full text-[10.5px] font-semibold flex items-center gap-1', k ? 'bg-accent text-white' : 'bg-black/55 text-white/85')}>
                  {k ? <><Check size={10} strokeWidth={3} /> Keep</> : 'Remove'}
                </span>
              </div>
              <div className="mt-2 text-[12px] font-medium truncate">{m.filename}</div>
              <div className="text-[11.5px] text-fg-3 tabular truncate">{resolution(m.width, m.height, m.rotation)} · {bytes(m.size)}</div>
              <div className="text-[11.5px] text-fg-3 truncate flex items-center gap-1" title={m.path}>
                {m.inLibrary ? <HardDrive size={10} /> : <Link2 size={10} />} {m.folderName ?? ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DuplicatesView() {
  const [similar, setSimilar] = useState(true)
  const [strictness, setStrictness] = useState<keyof typeof STRICTNESS>('balanced')
  const [result, setResult] = useState<DuplicateScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [keep, setKeep] = useState<Record<string, number>>({})
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(60)
  const task = useApp((s) => s.activity.task)
  const total = useApp((s) => s.counts.all)

  const scan = async (): Promise<void> => {
    setScanning(true)
    setResolved(new Set())
    try {
      const r = await call('duplicates.scan', { similar, threshold: STRICTNESS[strictness] })
      setResult(r)
      setKeep(Object.fromEntries(r.groups.map((g) => [g.key, g.suggestedKeep])))
      setLimit(60)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (total > 0 && total < 20000) void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = (result?.groups ?? []).filter((g) => !resolved.has(g.key))
  const removable = groups.flatMap((g) => g.items.filter((m) => m.id !== keep[g.key]))
  const savings = removable.reduce((n, m) => n + m.size, 0)

  return (
    <div className="flex-1 overflow-y-auto scroll">
      <div className="max-w-[1100px] mx-auto px-8 py-8">
        <div className="flex items-start gap-6 mb-6">
          <div className="flex-1">
            <h2 className="text-[20px] font-bold tracking-[-0.02em]">Find Duplicates</h2>
            <p className="text-[13px] text-fg-2 mt-1.5 max-w-[620px] leading-relaxed">
              Identical files are matched by their contents, so renamed copies are found too. “Look alike” also finds resized or re-saved versions. Nothing is deleted without
              your say-so, and removed items go to Recently Deleted first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-2xl border border-line bg-raised mb-6 flex-wrap">
          <label className="flex items-center gap-2.5 text-[13px]">
            <Switch checked={similar} onChange={setSimilar} label="Include look-alike photos" /> Include look-alikes
          </label>
          {similar && (
            <Segmented size="sm" value={strictness} options={[{ value: 'strict', label: 'Very similar' }, { value: 'balanced', label: 'Similar' }, { value: 'loose', label: 'Somewhat similar' }]} onChange={setStrictness} />
          )}
          <div className="flex-1" />
          <Button variant="primary" icon={ScanSearch} onClick={() => void scan()} disabled={scanning}>
            {scanning ? 'Scanning…' : result ? 'Scan Again' : 'Scan Library'}
          </Button>
        </div>

        {scanning && (
          <div className="flex flex-col items-center py-16 text-fg-2">
            <Spinner size={22} />
            <div className="mt-3 text-[13px]">{task ? `${task.label}… ${task.done.toLocaleString()} / ${task.total.toLocaleString()}` : 'Comparing your library…'}</div>
          </div>
        )}

        {!scanning && result && groups.length === 0 && (
          <div className="flex flex-col items-center text-center py-16">
            <div className="h-14 w-14 rounded-2xl bg-success/12 text-success flex items-center justify-center mb-4"><CheckCircle2 size={26} /></div>
            <div className="text-[16px] font-semibold">No duplicates found</div>
            <div className="text-[13px] text-fg-2 mt-1">Checked {count(result.scanned, 'item')} in {(result.durationMs / 1000).toFixed(1)} s.</div>
          </div>
        )}

        {!scanning && groups.length > 0 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="text-[13px]">
                <span className="font-semibold">{count(groups.length, 'group')}</span>
                <span className="text-fg-2"> · {count(removable.length, 'extra copy', 'extra copies')} · {bytes(savings)} could be freed</span>
              </div>
              <div className="flex-1" />
              <Button
                icon={Trash2}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Remove ${count(removable.length, 'duplicate')}?`,
                    message: `The copy marked “Keep” in each group stays. The others move to Recently Deleted, where you can restore them. Files on disk are only deleted if you later empty Recently Deleted and choose to.`,
                    confirmLabel: 'Move to Recently Deleted',
                    danger: true
                  })
                  if (!ok) return
                  await call('media.trash', removable.map((m) => m.id))
                  setResolved(new Set(groups.map((g) => g.key)))
                  toast(`Moved ${count(removable.length, 'duplicate')} to Recently Deleted`, { action: { label: 'Undo', run: () => void actions.undo() } })
                }}
              >
                Remove All Extras
              </Button>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-fg-3 mb-4">
              <Info size={13} /> Click a thumbnail to choose which copy to keep. The best-quality copy is pre-selected.
            </div>
            <div className="space-y-4">
              {groups.slice(0, limit).map((g) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  keep={keep[g.key] ?? g.suggestedKeep}
                  setKeep={(id) => setKeep((k) => ({ ...k, [g.key]: id }))}
                  onResolved={() => setResolved((r) => new Set(r).add(g.key))}
                />
              ))}
            </div>
            {groups.length > limit && (
              <div className="flex justify-center mt-6">
                <Button onClick={() => setLimit(limit + 60)}>Show More ({groups.length - limit} remaining)</Button>
              </div>
            )}
          </>
        )}
        {!scanning && !result && total === 0 && (
          <div className="text-center py-16 text-fg-2 text-[13px]">
            <Copy size={24} className="mx-auto mb-3 text-fg-3" />
            Import some photos first — then Loupe can look for duplicates.
          </div>
        )}
      </div>
    </div>
  )
}
