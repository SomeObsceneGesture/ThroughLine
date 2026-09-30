import { useState } from 'react'
import { CheckCircle2, AlertTriangle, Copy as CopyIcon, FolderOpen } from 'lucide-react'
import type { ImportSummary } from '@shared/types'
import { Button, Kbd, Modal } from '../ui/controls'
import { DialogFooter, DialogHeader } from './common'
import { SHORTCUTS } from '../../lib/shortcuts'
import { call } from '../../lib/api'
import { count, fileName } from '../../lib/format'
import { cx } from '../../lib/cx'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} width={760} labelledBy="dialog-title">
      <DialogHeader title="Keyboard Shortcuts" />
      <div className="px-6 pb-6 pt-3 grid grid-cols-2 gap-x-10 gap-y-6 overflow-auto scroll">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3 mb-2">{g.group}</h3>
            <dl className="space-y-1.5">
              {g.items.map(([k, v]) => (
                <div key={v} className="flex items-center justify-between gap-4 text-[13px]">
                  <dt className="text-fg-2">{v}</dt>
                  <dd className="flex gap-1 shrink-0">{k.split(' ').filter(Boolean).map((p, i) => <Kbd key={i}>{p}</Kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}

export function ImportSummaryDialog({ summary, onClose, onImportAnyway }: { summary: ImportSummary; onClose: () => void; onImportAnyway: (paths: string[]) => void }) {
  const [tab, setTab] = useState<'duplicates' | 'failed'>(summary.duplicates.length ? 'duplicates' : 'failed')
  const list = tab === 'duplicates' ? summary.duplicates : summary.failed
  return (
    <Modal onClose={onClose} width={620} labelledBy="dialog-title">
      <DialogHeader
        title={summary.added ? `Imported ${count(summary.added, 'item')}` : 'Nothing new was imported'}
        icon={<div className={cx('h-9 w-9 shrink-0 rounded-full flex items-center justify-center', summary.added ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>{summary.added ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</div>}
        subtitle={
          <span>
            {summary.alreadyInLibrary > 0 && `${count(summary.alreadyInLibrary, 'item')} ${summary.alreadyInLibrary === 1 ? 'was' : 'were'} already in your library. `}
            {summary.duplicates.length > 0 && `${count(summary.duplicates.length, 'duplicate')} skipped. `}
            {summary.failed.length > 0 && `${count(summary.failed.length, 'file')} couldn’t be read.`}
          </span>
        }
      />
      <div className="px-6 pt-3">
        <div className="flex gap-1 mb-2">
          {summary.duplicates.length > 0 && (
            <button onClick={() => setTab('duplicates')} className={cx('h-7 px-3 rounded-md text-[12.5px] font-medium', tab === 'duplicates' ? 'bg-active' : 'text-fg-2 hover:bg-hover')}>
              Duplicates ({summary.duplicates.length})
            </button>
          )}
          {summary.failed.length > 0 && (
            <button onClick={() => setTab('failed')} className={cx('h-7 px-3 rounded-md text-[12.5px] font-medium', tab === 'failed' ? 'bg-active' : 'text-fg-2 hover:bg-hover')}>
              Couldn’t import ({summary.failed.length})
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-auto scroll rounded-lg border border-line divide-y divide-[var(--line)]">
          {list.slice(0, 500).map((it) => (
            <div key={it.path} className="flex items-center gap-3 px-3 py-2 text-[12.5px] group">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={it.path}>{fileName(it.path)}</div>
                <div className="truncate text-fg-3">{it.reason}</div>
              </div>
              <button aria-label="Show in folder" className="opacity-0 group-hover:opacity-100 h-7 w-7 rounded-md flex items-center justify-center text-fg-2 hover:bg-hover" onClick={() => void call('app.showItemInFolder', it.path)}>
                <FolderOpen size={14} />
              </button>
            </div>
          ))}
          {list.length > 500 && <div className="px-3 py-2 text-fg-3 text-[12px]">…and {count(list.length - 500, 'more file')}</div>}
        </div>
      </div>
      <DialogFooter>
        {tab === 'duplicates' && summary.duplicates.length > 0 && (
          <Button icon={CopyIcon} variant="ghost" className="mr-auto" onClick={() => onImportAnyway(summary.duplicates.map((d) => d.path))}>
            Import Duplicates Anyway
          </Button>
        )}
        <Button variant="primary" onClick={onClose} data-autofocus>Done</Button>
      </DialogFooter>
    </Modal>
  )
}
