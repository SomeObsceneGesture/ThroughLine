import { memo, useState } from 'react'
import { Heart, Play, ImageOff, WifiOff, Check, Star } from 'lucide-react'
import type { InfoFields, MediaItem } from '@shared/types'
import { FLAG_FAVORITE, FLAG_MISSING, FLAG_THUMB, FLAG_THUMB_FAILED, FLAG_VIDEO, rotationFromFlags } from '@shared/types'
import { thumbUrl } from '../../lib/api'
import { cx } from '../../lib/cx'
import { date, duration, resolution, bytes, typeLabel } from '../../lib/format'

export interface CellProps {
  id: number
  index: number
  x: number
  y: number
  w: number
  h: number
  imageH: number
  item?: MediaItem
  flags: number
  selected: boolean
  focused: boolean
  selecting: boolean
  contain: boolean
  info: InfoFields
  radius: number
  dropBefore?: boolean
}

function Thumb({ id, version, rotation, contain, w, h, ext }: { id: number; version: number; rotation: number; contain: boolean; w: number; h: number; ext?: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const swap = rotation % 180 !== 0
  const style: React.CSSProperties = swap
    ? { position: 'absolute', width: h, height: w, left: (w - h) / 2, top: (h - w) / 2, transform: `rotate(${rotation}deg)`, objectFit: contain ? 'contain' : 'cover' }
    : { width: '100%', height: '100%', objectFit: contain ? 'contain' : 'cover', transform: rotation ? `rotate(${rotation}deg)` : undefined }
  if (failed) return <Broken ext={ext} />
  return (
    <img
      src={thumbUrl(id, version)}
      alt=""
      draggable={false}
      decoding="async"
      className={cx('thumb-img block', loaded && 'loaded')}
      style={style}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  )
}

function Broken({ ext, label }: { ext?: string; label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-fg-3">
      <ImageOff size={20} strokeWidth={1.5} />
      <span className="text-[10.5px] font-medium uppercase tracking-wide">{label ?? ext ?? ''}</span>
    </div>
  )
}

export const Cell = memo(function Cell(p: CellProps) {
  const it = p.item
  const video = !!(p.flags & FLAG_VIDEO)
  const thumbReady = it ? it.thumbState === 1 : !!(p.flags & FLAG_THUMB)
  const thumbFailed = it ? it.thumbState === 2 : !!(p.flags & FLAG_THUMB_FAILED)
  const favorite = it ? it.favorite : !!(p.flags & FLAG_FAVORITE)
  const missing = it ? it.missing : !!(p.flags & FLAG_MISSING)
  const rotation = it ? it.rotation : rotationFromFlags(p.flags)
  const version = it?.thumbVersion ?? 0
  const captionH = p.h - p.imageH
  const meta: string[] = []
  if (it) {
    if (p.info.date) meta.push(date(it.sortDate))
    if (p.info.type) meta.push(typeLabel(it))
    if (p.info.resolution && it.width) meta.push(resolution(it.width, it.height, it.rotation))
    if (p.info.size) meta.push(bytes(it.size))
    if (p.info.folder && it.folderName) meta.push(it.folderName)
  }
  return (
    <div
      data-index={p.index}
      data-media-id={p.id}
      role="gridcell"
      aria-selected={p.selected}
      aria-label={it?.filename}
      className="absolute group"
      style={{ transform: `translate3d(${p.x}px, ${p.y}px, 0)`, width: p.w, height: p.h }}
      draggable
    >
      <div
        data-frame
        className={cx(
          'relative overflow-hidden bg-thumb transition-[box-shadow,transform] duration-150',
          p.selected && 'shadow-[0_0_0_3px_var(--accent)]',
          p.focused && !p.selected && 'shadow-[0_0_0_2px_var(--line-strong)]'
        )}
        style={{ height: p.imageH, borderRadius: p.radius }}
      >
        {thumbReady ? (
          <Thumb id={p.id} version={version} rotation={rotation} contain={p.contain} w={p.w} h={p.imageH} ext={it?.ext} />
        ) : thumbFailed ? (
          <Broken ext={it?.ext} label={missing ? 'Missing' : undefined} />
        ) : (
          <div className="absolute inset-0 shimmer" />
        )}
        {p.selected && <div className="absolute inset-0 bg-[var(--accent)] opacity-[0.12] pointer-events-none" />}
        {/* selection affordance */}
        <div
          data-select-toggle
          className={cx(
            'absolute top-1.5 left-1.5 h-[22px] w-[22px] rounded-full flex items-center justify-center transition-opacity duration-150',
            p.selected ? 'bg-accent text-white opacity-100 shadow' : 'border-[1.5px] border-white/90 bg-black/20 text-transparent shadow-[0_0_4px_rgba(0,0,0,.4)]',
            !p.selected && (p.selecting ? 'opacity-80' : 'opacity-0 group-hover:opacity-90')
          )}
        >
          <Check size={13} strokeWidth={3} />
        </div>
        {missing && (
          <div className="absolute top-1.5 right-1.5 h-5 px-1.5 rounded-md bg-black/60 text-white text-[10.5px] font-medium flex items-center gap-1" title="The original file isn’t available">
            <WifiOff size={10} /> Offline
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ opacity: favorite || (video && p.info.duration) || (p.info.rating && (it?.rating ?? 0) > 0) ? 1 : undefined }} />
        <button
          data-fav-toggle
          aria-label={favorite ? 'Unfavorite' : 'Favorite'}
          className={cx(
            'absolute bottom-1 left-1 h-6 w-6 flex items-center justify-center rounded-md transition-opacity',
            favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-80 hover:opacity-100!'
          )}
        >
          <Heart size={14} strokeWidth={2} className={cx('drop-shadow-[0_1px_2px_rgba(0,0,0,.5)]', favorite ? 'fill-white text-white' : 'text-white')} />
        </button>
        {p.info.rating && it && it.rating > 0 && (
          <div className={cx('absolute bottom-1.5 flex gap-px text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]', favorite ? 'left-7' : 'left-2')} aria-label={`${it.rating} stars`}>
            {Array.from({ length: it.rating }, (_, i) => <Star key={i} size={10} className="fill-white" />)}
          </div>
        )}
        {video && (
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 text-white text-[11px] font-semibold tabular drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">
            <Play size={10} className="fill-white" />
            {p.info.duration && it?.duration ? duration(it.duration) : null}
          </div>
        )}
      </div>
      {captionH > 4 && (
        <div className="pt-1.5 px-0.5 overflow-hidden" style={{ height: captionH }}>
          {p.info.filename && <div className="text-[12px] text-fg truncate leading-[17px]">{it?.filename ?? ' '}</div>}
          {meta.length > 0 && <div className="text-[11px] text-fg-3 truncate leading-[17px] tabular">{meta.join(' · ')}</div>}
          {p.info.tags && <div className="text-[11px] text-accent truncate leading-[17px]">{it?.tags.map((t) => `#${t}`).join(' ') || ' '}</div>}
        </div>
      )}
      {p.dropBefore && <div className="absolute -left-[5px] top-0 bottom-0 w-[3px] rounded-full bg-accent shadow-[0_0_0_2px_var(--canvas)]" />}
    </div>
  )
})
