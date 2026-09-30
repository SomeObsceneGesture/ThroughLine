import { useCallback, useEffect, useState } from 'react'
import { Heart, Star, FolderOpen, Copy, X, Plus, Images, Tag as TagIcon, AlertTriangle, RefreshCw, MapPin, HardDrive, Link2, Pencil, Camera, Film, FileImage } from 'lucide-react'
import type { MediaDetails, MediaItem } from '@shared/types'
import { call, on, thumbUrl, isMac } from '../lib/api'
import { fetchItems } from '../lib/items'
import { bytes, count, dateTime, duration, exposure, megapixels, resolution, typeLabel, videoRes } from '../lib/format'
import { cx } from '../lib/cx'
import { useApp } from '../store/app'
import { useGallery } from '../store/gallery'
import { useUI } from '../store/ui'
import * as actions from '../lib/actions'
import { IconButton, Tooltip } from './ui/controls'

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-[5px] text-[12.5px]">
      <dt className="w-[92px] shrink-0 text-fg-3">{label}</dt>
      <dd className={cx('min-w-0 flex-1 text-fg break-words select-text', mono && 'tabular')}>{children}</dd>
    </div>
  )
}

function Section({ title, icon: Icon, children, action }: { title: string; icon?: typeof Camera; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-t border-line">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={13} className="text-fg-3" />}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  )
}

export function Stars({ value, onChange, size = 15 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value
  return (
    <div className="flex items-center" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
          className="p-0.5"
        >
          <Star size={size} strokeWidth={1.8} className={cx('transition-colors', n <= shown ? 'fill-warning text-warning' : 'text-fg-3 opacity-50')} />
        </button>
      ))}
    </div>
  )
}

function TagEditor({ ids, tags }: { ids: number[]; tags: { id: number; name: string; count?: number }[] }) {
  const [text, setText] = useState('')
  const all = useApp((s) => s.tags)
  const t = text.trim().replace(/^#/, '').toLowerCase()
  const suggestions = t ? all.filter((x) => x.name.toLowerCase().includes(t) && !tags.some((y) => y.id === x.id)).slice(0, 5) : []
  const add = async (name: string): Promise<void> => {
    const names = name.split(',').map((s) => s.trim()).filter(Boolean)
    if (!names.length) return
    await call('tags.add', ids, names)
    setText('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tg) => (
          <span key={tg.id} className="inline-flex items-center gap-0.5 h-6 pl-2 pr-0.5 rounded-full bg-accent-soft text-[12px] font-medium">
            <button className="hover:underline" onClick={() => useApp.getState().navigate({ kind: 'view', view: { type: 'tag', id: tg.id } })}>#{tg.name}</button>
            {tg.count !== undefined && tg.count < ids.length && <span className="text-fg-3 font-normal ml-0.5">{tg.count}</span>}
            <button aria-label={`Remove ${tg.name}`} className="h-5 w-5 rounded-full flex items-center justify-center text-fg-3 hover:text-fg hover:bg-hover" onClick={() => void call('tags.remove', ids, [tg.id])}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="relative mt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add(suggestions.length && !all.some((x) => x.name.toLowerCase() === t) && !text.includes(',') ? suggestions[0].name : text)
            if (e.key === 'Escape') {
              e.stopPropagation()
              setText('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Add tag…"
          aria-label="Add tag"
          className="w-full h-7 px-2.5 rounded-md bg-input border border-line text-[12.5px] placeholder:text-fg-3 focus:border-accent"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-20 top-8 left-0 right-0 py-1 rounded-lg bg-overlay shadow-pop">
            {suggestions.map((s) => (
              <button key={s.id} onMouseDown={(e) => e.preventDefault()} onClick={() => void add(s.name)} className="w-full h-7 px-2.5 text-left text-[12.5px] hover:bg-hover flex items-center gap-2">
                <TagIcon size={11} className="text-fg-3" /> {s.name} <span className="ml-auto text-fg-3 text-[11px]">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Single({ id }: { id: number }) {
  const [d, setD] = useState<MediaDetails | null>(null)
  const load = useCallback(() => {
    void call('media.details', id).then(setD)
  }, [id])
  useEffect(() => {
    load()
    const off1 = on('library:changed', (c) => {
      if (c.type !== 'items' || c.ids.includes(id)) load()
    })
    const off2 = on('media:updated', (c) => {
      if (c.ids.includes(id)) load()
    })
    return () => {
      off1()
      off2()
    }
  }, [id, load])
  if (!d) return <div className="p-4 text-fg-3 text-[12.5px]">Loading…</div>
  const md = d.metadata
  const camLine = [md.fNumber ? `ƒ/${md.fNumber}` : '', exposure(md.exposureTime), md.iso ? `ISO ${md.iso}` : '', md.focalLength ? `${md.focalLength} mm${md.focalLength35 && md.focalLength35 !== md.focalLength ? ` (${md.focalLength35} mm eq.)` : ''}` : '']
    .filter(Boolean)
    .join('  ·  ')
  return (
    <>
      <div className="p-4">
        <div className="aspect-[4/3] rounded-lg bg-thumb overflow-hidden flex items-center justify-center mb-3">
          {d.thumbState === 1 ? (
            <img src={thumbUrl(d.id, d.thumbVersion)} alt="" className="max-h-full max-w-full object-contain" style={{ transform: d.rotation ? `rotate(${d.rotation}deg)` : undefined }} />
          ) : (
            <FileImage size={28} className="text-fg-3" />
          )}
        </div>
        <button className="group flex items-start gap-1.5 text-left w-full" onClick={() => void actions.rename(d.id)} title="Rename">
          <span className="font-semibold text-[14px] leading-snug break-all">{d.filename}</span>
          <Pencil size={12} className="mt-1 text-fg-3 opacity-0 group-hover:opacity-100 shrink-0" />
        </button>
        <div className="text-[12.5px] text-fg-2 mt-0.5">{dateTime(d.sortDate)}</div>
        <div className="flex items-center gap-2 mt-3">
          <Stars value={d.rating} onChange={(v) => void actions.setRating([d.id], v)} />
          <div className="flex-1" />
          <Tooltip label={d.favorite ? 'Unfavorite (F)' : 'Favorite (F)'}>
            <button className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-hover" onClick={() => void actions.toggleFavorite([d.id])} aria-label="Favorite">
              <Heart size={17} className={d.favorite ? 'fill-danger text-danger' : 'text-fg-3'} />
            </button>
          </Tooltip>
        </div>
        {(d.error || d.missing) && (
          <div className="mt-3 p-3 rounded-lg bg-warning/10 text-[12.5px] flex gap-2.5">
            <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-medium">{d.missing ? 'Original not available' : 'Couldn’t read this file'}</div>
              <div className="text-fg-2 mt-0.5">{d.missing ? 'It may have been moved, deleted, or be on a disconnected drive.' : d.error}</div>
              <button className="mt-1.5 text-accent text-[12px] font-medium flex items-center gap-1" onClick={() => void call('media.regenerateThumbs', [d.id])}>
                <RefreshCw size={11} /> Try again
              </button>
            </div>
          </div>
        )}
      </div>

      <Section title="Details" icon={d.kind === 'video' ? Film : FileImage}>
        <dl>
          <Row label="Type">{typeLabel(d)}{d.kind === 'video' && d.width ? ` · ${videoRes(d.width, d.height)}` : ''}</Row>
          <Row label="Dimensions" mono>
            {resolution(d.width, d.height, d.rotation)} {megapixels(d.width, d.height) && <span className="text-fg-3">· {megapixels(d.width, d.height)}</span>}
          </Row>
          <Row label="Size" mono>{bytes(d.size)}</Row>
          {d.duration ? <Row label="Length" mono>{duration(d.duration)}</Row> : null}
          <Row label={d.takenAt ? 'Captured' : 'Modified'}>{dateTime(d.takenAt ?? d.mtime)}</Row>
          <Row label="Added">{dateTime(d.addedAt)}</Row>
          {d.lastViewedAt && <Row label="Last viewed">{dateTime(d.lastViewedAt)}</Row>}
          {d.duplicateOf && <Row label="Duplicates">{count(d.duplicateOf.length, 'identical copy', 'identical copies')} in library</Row>}
        </dl>
      </Section>

      {(md.model || md.lens || camLine) && (
        <Section title="Camera" icon={Camera}>
          <dl>
            {md.model && <Row label="Camera">{md.model}</Row>}
            {md.lens && <Row label="Lens">{md.lens}</Row>}
            {camLine && <Row label="Exposure" mono>{camLine}</Row>}
            {md.flash && <Row label="Flash">{md.flash}</Row>}
            {md.software && <Row label="Software">{md.software}</Row>}
          </dl>
        </Section>
      )}

      {d.kind === 'video' && (md.codec || md.fps) && (
        <Section title="Video" icon={Film}>
          <dl>
            {md.codec && <Row label="Codec">{md.codec.toUpperCase()}</Row>}
            {md.fps && <Row label="Frame rate" mono>{md.fps} fps</Row>}
            {md.bitrate && <Row label="Bitrate" mono>{(md.bitrate / 1e6).toFixed(1)} Mbps</Row>}
            <Row label="Audio">{md.audioCodec ? md.audioCodec.toUpperCase() : 'None'}</Row>
          </dl>
        </Section>
      )}

      {md.gps && (
        <Section title="Location" icon={MapPin}>
          <div className="flex items-center gap-2 text-[12.5px] tabular select-text">
            {md.gps.lat.toFixed(5)}, {md.gps.lon.toFixed(5)}
            {md.gps.alt !== undefined && <span className="text-fg-3">· {Math.round(md.gps.alt)} m</span>}
            <IconButton icon={Copy} label="Copy coordinates" size={13} className="h-6! w-6! ml-auto" onClick={() => void call('app.copyText', `${md.gps!.lat}, ${md.gps!.lon}`)} />
          </div>
        </Section>
      )}

      <Section title="Tags" icon={TagIcon}>
        <TagEditor ids={[d.id]} tags={d.tagList} />
      </Section>

      <Section title="Albums" icon={Images} action={<IconButton icon={Plus} label="Add to album" size={13} className="h-6! w-6!" onClick={() => actions.albumPicker([d.id])} />}>
        {d.albums.length === 0 ? (
          <div className="text-[12.5px] text-fg-3">Not in any album.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {d.albums.map((a) => (
              <button key={a.id} onClick={() => useApp.getState().navigate({ kind: 'view', view: { type: 'album', id: a.id } })} className="h-6 px-2.5 rounded-full bg-hover hover:bg-active text-[12px]">
                {a.name}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="File" icon={d.inLibrary ? HardDrive : Link2}>
        <div className="text-[12px] text-fg-2 break-all select-text leading-relaxed">{d.path}</div>
        <div className="text-[11.5px] text-fg-3 mt-1">{d.inLibrary ? 'Stored inside your library' : 'Kept in its original location'}</div>
        <div className="flex gap-1.5 mt-2">
          <button className="h-7 px-2.5 rounded-md bg-hover hover:bg-active text-[12px] flex items-center gap-1.5" onClick={() => void call('app.showItemInFolder', d.path)}>
            <FolderOpen size={13} /> {isMac ? 'Show in Finder' : 'Show in Folder'}
          </button>
          <button className="h-7 px-2.5 rounded-md bg-hover hover:bg-active text-[12px] flex items-center gap-1.5" onClick={() => void actions.copyPaths([d.id])}>
            <Copy size={13} /> Copy Path
          </button>
        </div>
      </Section>
    </>
  )
}

function Multiple({ ids }: { ids: number[] }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [tags, setTags] = useState<{ id: number; name: string; count: number }[]>([])
  const load = useCallback(() => {
    void fetchItems(ids.slice(0, 2000)).then(setItems)
    void call('tags.forMedia', ids).then(setTags)
  }, [ids])
  useEffect(() => {
    load()
    return on('library:changed', () => load())
  }, [load])
  const size = items.reduce((n, m) => n + m.size, 0)
  const dates = items.map((m) => m.sortDate).sort((a, b) => a - b)
  const photos = items.filter((m) => m.kind === 'photo').length
  const allFav = items.length > 0 && items.every((m) => m.favorite)
  return (
    <>
      <div className="p-4">
        <div className="grid grid-cols-3 gap-1 mb-3">
          {ids.slice(0, 6).map((id) => (
            <div key={id} className="aspect-square rounded-md bg-thumb overflow-hidden">
              <img src={thumbUrl(id, items.find((m) => m.id === id)?.thumbVersion ?? 0)} alt="" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0')} />
            </div>
          ))}
        </div>
        <div className="font-semibold text-[14px]">{count(ids.length, 'item')} selected</div>
        <div className="text-[12.5px] text-fg-2 mt-0.5">
          {photos > 0 && count(photos, 'photo')}
          {photos > 0 && items.length - photos > 0 && ', '}
          {items.length - photos > 0 && count(items.length - photos, 'video')}
          {' · '}
          {bytes(size)}
        </div>
        {dates.length > 0 && <div className="text-[12px] text-fg-3 mt-0.5">{dateTime(dates[0])} – {dateTime(dates[dates.length - 1])}</div>}
        <div className="flex items-center gap-2 mt-3">
          <Stars value={items.length && items.every((m) => m.rating === items[0].rating) ? items[0].rating : 0} onChange={(v) => void actions.setRating(ids, v)} />
          <div className="flex-1" />
          <button className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-hover" onClick={() => void actions.toggleFavorite(ids)} aria-label="Favorite all">
            <Heart size={17} className={allFav ? 'fill-danger text-danger' : 'text-fg-3'} />
          </button>
        </div>
      </div>
      <Section title="Tags" icon={TagIcon}>
        <TagEditor ids={ids} tags={tags} />
      </Section>
      <Section title="Albums" icon={Images}>
        <button className="h-7 px-2.5 rounded-md bg-hover hover:bg-active text-[12px] flex items-center gap-1.5" onClick={() => actions.albumPicker(ids)}>
          <Plus size={13} /> Add to Album…
        </button>
      </Section>
    </>
  )
}

export function InfoPanel({ ids: explicit, onClose }: { ids?: number[]; onClose?: () => void }) {
  const selection = useGallery((s) => s.selection)
  const focus = useGallery((s) => s.focus)
  const total = useGallery((s) => s.layout?.total ?? 0)
  const ids = explicit ?? (selection.size ? [...selection] : focus !== null ? [focus] : [])
  return (
    <aside className="w-[300px] shrink-0 border-l border-line bg-canvas flex flex-col min-h-0 anim-fade" aria-label="Info">
      <div className="h-11 shrink-0 flex items-center px-4">
        <span className="text-[13px] font-semibold">Info</span>
        <div className="ml-auto">
          <IconButton icon={X} label="Close info" size={14} onClick={onClose ?? (() => useUI.setState({ infoPanel: false }))} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll pb-6">
        {ids.length === 0 ? (
          <div className="px-4 pt-6 text-center text-[12.5px] text-fg-3">
            {count(total, 'item')} in this view.
            <br />
            Select something to see its details.
          </div>
        ) : ids.length === 1 ? (
          <Single id={ids[0]} />
        ) : (
          <Multiple ids={ids} />
        )}
      </div>
    </aside>
  )
}
