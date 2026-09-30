import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Tag as TagIcon, X, Check, Images, Trash2, HardDrive, FolderOpen } from 'lucide-react'
import { Button, Modal, TextInput } from '../ui/controls'
import { DialogFooter, DialogHeader } from './common'
import { call, thumbUrl } from '../../lib/api'
import { useApp } from '../../store/app'
import { cx } from '../../lib/cx'
import { count } from '../../lib/format'

// ─── Tags ───────────────────────────────────────────────────────────────────

export function TagDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const allTags = useApp((s) => s.tags)
  const [applied, setApplied] = useState<{ id: number; name: string; count: number }[]>([])
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = async (): Promise<void> => setApplied(await call('tags.forMedia', ids))
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const suggestions = useMemo(() => {
    const t = text.trim().replace(/^#/, '').toLowerCase()
    const appliedFull = new Set(applied.filter((a) => a.count === ids.length).map((a) => a.id))
    const list = allTags.filter((tg) => !appliedFull.has(tg.id) && (!t || tg.name.toLowerCase().includes(t)))
    list.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(t) ? 0 : 1
      const bp = b.name.toLowerCase().startsWith(t) ? 0 : 1
      return ap - bp || b.count - a.count
    })
    return list.slice(0, 8)
  }, [text, allTags, applied, ids.length])

  const exact = allTags.some((tg) => tg.name.toLowerCase() === text.trim().replace(/^#/, '').toLowerCase())

  const add = async (names: string[]): Promise<void> => {
    const clean = names.map((n) => n.trim().replace(/^#+/, '')).filter(Boolean)
    if (!clean.length) return
    await call('tags.add', ids, clean)
    setText('')
    setActive(0)
    await refresh()
    inputRef.current?.focus()
  }
  const remove = async (tagId: number): Promise<void> => {
    await call('tags.remove', ids, [tagId])
    await refresh()
  }

  const options: { label: string; create?: boolean; name: string }[] = [
    ...(text.trim() && !exact ? [{ label: `Create “${text.trim().replace(/^#/, '')}”`, create: true, name: text.trim() }] : []),
    ...suggestions.map((s) => ({ label: s.name, name: s.name }))
  ]

  return (
    <Modal onClose={onClose} width={440} labelledBy="dialog-title">
      <DialogHeader title={`Tags for ${count(ids.length, 'item')}`} subtitle="Type to add a tag. Separate several with commas." />
      <div className="px-6 pt-2">
        <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
          {applied.length === 0 && <span className="text-[12.5px] text-fg-3 self-center">No tags yet.</span>}
          {applied.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-accent-soft text-[12.5px] font-medium text-fg">
              #{t.name}
              {t.count < ids.length && <span className="text-fg-3 font-normal">{t.count}/{ids.length}</span>}
              {t.count < ids.length && (
                <button aria-label={`Apply ${t.name} to all`} className="h-5 px-1.5 rounded-full text-[11px] text-accent hover:bg-hover" onClick={() => void add([t.name])}>
                  all
                </button>
              )}
              <button aria-label={`Remove ${t.name}`} className="h-5 w-5 rounded-full flex items-center justify-center text-fg-2 hover:text-fg hover:bg-hover" onClick={() => void remove(t.id)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <TextInput
          ref={inputRef}
          icon={TagIcon}
          placeholder="Add a tag…"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(options.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (text.includes(',')) void add(text.split(','))
              else if (options[active]) void add([options[active].name])
              else if (text.trim()) void add([text])
              else onClose()
            }
          }}
          data-autofocus
        />
        <div className="mt-2 max-h-56 overflow-auto scroll -mx-1">
          {options.map((o, i) => (
            <button
              key={o.label}
              onMouseEnter={() => setActive(i)}
              onClick={() => void add([o.name])}
              className={cx('w-full flex items-center gap-2 h-8 px-2.5 mx-1 rounded-md text-left text-[13px]', i === active ? 'bg-hover' : '')}
              style={{ width: 'calc(100% - 8px)' }}
            >
              {o.create ? <Plus size={14} className="text-accent" /> : <TagIcon size={13} className="text-fg-3" />}
              <span className={cx('flex-1 truncate', o.create && 'text-accent')}>{o.label}</span>
              {!o.create && <span className="text-fg-3 text-[12px] tabular">{allTags.find((t) => t.name === o.name)?.count ?? ''}</span>}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </DialogFooter>
    </Modal>
  )
}

// ─── Albums ─────────────────────────────────────────────────────────────────

export function AlbumPicker({ ids, onPick, onClose }: { ids: number[]; onPick: (albumId: number | 'new', name?: string) => void; onClose: () => void }) {
  const albums = useApp((s) => s.albums)
  const [text, setText] = useState('')
  const [membership, setMembership] = useState<Map<number, number>>(new Map())
  const [active, setActive] = useState(0)
  useEffect(() => {
    void call('albums.forMedia', ids).then((r) => setMembership(new Map(r.map((x) => [x.id, x.count]))))
  }, [ids])
  const t = text.trim().toLowerCase()
  const list = albums.filter((a) => !t || a.name.toLowerCase().includes(t))
  const exact = albums.some((a) => a.name.toLowerCase() === t)
  const rows: ({ kind: 'new'; name: string } | { kind: 'album'; id: number; name: string; count: number; coverId: number | null })[] = [
    ...(t && !exact ? [{ kind: 'new' as const, name: text.trim() }] : []),
    ...list.map((a) => ({ kind: 'album' as const, id: a.id, name: a.name, count: a.count, coverId: a.coverId }))
  ]
  const choose = (i: number): void => {
    const r = rows[i]
    if (!r) return
    if (r.kind === 'new') onPick('new', r.name)
    else onPick(r.id)
  }
  return (
    <Modal onClose={onClose} width={420} labelledBy="dialog-title">
      <DialogHeader title={`Add ${count(ids.length, 'item')} to an album`} />
      <div className="px-6 pt-2">
        <TextInput
          icon={Search}
          placeholder={albums.length ? 'Find or create an album…' : 'Name your first album…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(rows.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(active)
            }
          }}
          data-autofocus
        />
        <div className="mt-3 max-h-72 overflow-auto scroll -mx-2 pb-1">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-fg-3 text-[12.5px]">Type a name to create an album.</div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.kind === 'new' ? 'new' : r.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={cx('w-full flex items-center gap-3 h-12 px-2 rounded-lg text-left', i === active && 'bg-hover')}
            >
              <div className="h-9 w-9 rounded-md bg-thumb overflow-hidden shrink-0 flex items-center justify-center">
                {r.kind === 'new' ? <Plus size={16} className="text-accent" /> : r.coverId ? <img src={thumbUrl(r.coverId)} className="h-full w-full object-cover" alt="" /> : <Images size={16} className="text-fg-3" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cx('text-[13px] truncate', r.kind === 'new' && 'text-accent font-medium')}>{r.kind === 'new' ? `New album “${r.name}”` : r.name}</div>
                {r.kind === 'album' && <div className="text-[11.5px] text-fg-3">{count(r.count, 'item')}</div>}
              </div>
              {r.kind === 'album' && (membership.get(r.id) ?? 0) >= ids.length && <Check size={16} className="text-accent" />}
              {r.kind === 'album' && (membership.get(r.id) ?? 0) > 0 && (membership.get(r.id) ?? 0) < ids.length && (
                <span className="text-[11px] text-fg-3">{membership.get(r.id)} already</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </DialogFooter>
    </Modal>
  )
}

// ─── Permanent delete ───────────────────────────────────────────────────────

export function DeleteDialog({ copied, referenced, onDone }: { copied: number; referenced: number; onDone: (choice: 'library' | 'files' | null) => void }) {
  const total = copied + referenced
  return (
    <Modal onClose={() => onDone(null)} width={500} labelledBy="dialog-title">
      <DialogHeader
        title={`Delete ${count(total, 'item')} permanently?`}
        icon={<div className="h-9 w-9 shrink-0 rounded-full bg-danger/15 text-danger flex items-center justify-center"><Trash2 size={17} /></div>}
        subtitle={
          <div className="space-y-2">
            <p>This removes {total === 1 ? 'it' : 'them'} from your library, including tags and album membership. This can’t be undone in Loupe.</p>
            <ul className="text-[12.5px] space-y-1">
              {copied > 0 && (
                <li className="flex items-center gap-2"><HardDrive size={13} className="text-fg-3" /> {count(copied, 'file')} stored inside your library</li>
              )}
              {referenced > 0 && (
                <li className="flex items-center gap-2"><FolderOpen size={13} className="text-fg-3" /> {count(referenced, 'file')} in {referenced === 1 ? 'its' : 'their'} original location</li>
              )}
            </ul>
            <p className="text-[12.5px]">“Move Files to Trash” sends the files to your system’s Trash, where they can still be recovered.</p>
          </div>
        }
      />
      <DialogFooter>
        <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
        <Button onClick={() => onDone('library')} data-autofocus>Remove from Library Only</Button>
        <Button variant="danger" onClick={() => onDone('files')}>Move Files to Trash</Button>
      </DialogFooter>
    </Modal>
  )
}
