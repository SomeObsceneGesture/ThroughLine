import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Images, Image as ImageIcon, Film, Heart, Clock, History, CalendarDays, Plus, ChevronRight, Folder, FolderOpen, Hash,
  LayoutGrid, Repeat, Copy, Trash2, Settings, HardDrive, Link2, WifiOff, PanelLeftClose, Pause, Play, X
} from 'lucide-react'
import type { ViewSpec, FolderNode, Album } from '@shared/types'
import { useApp, type Route } from '../store/app'
import { useUI, toast } from '../store/ui'
import { useDropTarget } from '../lib/dnd'
import { cx } from '../lib/cx'
import { call, isMac, thumbUrl } from '../lib/api'
import { count } from '../lib/format'
import * as actions from '../lib/actions'
import { IconButton, ProgressBar, Tooltip } from './ui/controls'

function sameView(a: ViewSpec, b: ViewSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function Item({
  icon: Icon, label, count: n, active, onClick, onContextMenu, drop, indent = 0, dim, trailing, title, thumb, onDoubleClick
}: {
  icon?: typeof Images
  label: ReactNode
  count?: number
  active?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  drop?: { onMedia?: (ids: number[]) => void; onFiles?: (paths: string[]) => void }
  indent?: number
  dim?: boolean
  trailing?: ReactNode
  title?: string
  thumb?: string | null
}) {
  const { over, handlers } = useDropTarget(drop ?? {})
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(e as unknown as React.MouseEvent)
        }
      }}
      onContextMenu={onContextMenu}
      {...(drop ? handlers : {})}
      className={cx(
        'group relative flex items-center gap-2.5 h-[30px] mx-2 pr-2 rounded-md text-[13px] transition-colors duration-100',
        active ? 'bg-active text-fg font-medium' : 'text-fg-2 hover:bg-hover hover:text-fg',
        over && 'bg-accent! text-accent-fg! shadow-[0_0_0_2px_var(--accent)]',
        dim && 'opacity-55'
      )}
      style={{ paddingLeft: 10 + indent * 14 }}
    >
      {thumb !== undefined ? (
        <div className="h-[18px] w-[18px] rounded-[4px] overflow-hidden bg-thumb shrink-0 flex items-center justify-center">
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : Icon && <Icon size={12} className="text-fg-3" />}
        </div>
      ) : (
        Icon && <Icon size={16} strokeWidth={1.75} className={cx('shrink-0', active ? 'text-accent' : over ? '' : 'text-fg-3 group-hover:text-fg-2')} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
      {n !== undefined && n > 0 && <span className={cx('text-[11.5px] tabular', over ? '' : 'text-fg-3')}>{n.toLocaleString()}</span>}
    </div>
  )
}

function Section({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  const open = useApp((s) => s.prefs?.sidebarSections[id] ?? true)
  const setPrefs = useApp((s) => s.setPrefs)
  const sections = useApp((s) => s.prefs?.sidebarSections ?? {})
  return (
    <div className="mt-4">
      <div className="group flex items-center h-6 px-4 mb-0.5">
        <button
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-3 hover:text-fg-2"
          onClick={() => setPrefs({ sidebarSections: { ...sections, [id]: !open } })}
          aria-expanded={open}
        >
          {title}
          <ChevronRight size={11} className={cx('transition-transform duration-150 opacity-0 group-hover:opacity-100', open && 'rotate-90')} />
        </button>
        <div className="ml-auto">{action}</div>
      </div>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  )
}

function FolderTree({ nodes }: { nodes: FolderNode[] }) {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const collapsed = useApp((s) => s.prefs?.collapsedFolders ?? [])
  const setPrefs = useApp((s) => s.setPrefs)
  const [multi, setMulti] = useState<number[]>([])
  const lastClicked = useRef<number | null>(null)
  const children = useMemo(() => {
    const m = new Map<number | null, FolderNode[]>()
    for (const n of nodes) {
      const l = m.get(n.parentId) ?? []
      l.push(n)
      m.set(n.parentId, l)
    }
    return m
  }, [nodes])
  const totals = useMemo(() => {
    const t = new Map<number, number>()
    const sum = (n: FolderNode): number => {
      let v = n.count
      for (const c of children.get(n.id) ?? []) v += sum(c)
      t.set(n.id, v)
      return v
    }
    for (const r of children.get(null) ?? []) sum(r)
    return t
  }, [children])
  const isOpen = (n: FolderNode): boolean => collapsed.includes(n.id) !== (n.parentId === null)
  const flatVisible = useMemo(() => {
    const out: FolderNode[] = []
    const walk = (list: FolderNode[]): void => {
      for (const n of list) {
        out.push(n)
        if (isOpen(n)) walk(children.get(n.id) ?? [])
      }
    }
    walk(children.get(null) ?? [])
    return out
  }, [children, collapsed]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeIds = route.kind === 'view' && route.view.type === 'folder' ? route.view.ids : []
  const toggle = (id: number): void => {
    setPrefs({ collapsedFolders: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id] })
  }
  const click = (e: React.MouseEvent, n: FolderNode): void => {
    let ids = [n.id]
    if (e.metaKey || e.ctrlKey) {
      const base = activeIds.length ? activeIds : multi
      ids = base.includes(n.id) ? base.filter((x) => x !== n.id) : [...base, n.id]
      if (!ids.length) ids = [n.id]
    } else if (e.shiftKey && lastClicked.current !== null) {
      const a = flatVisible.findIndex((f) => f.id === lastClicked.current)
      const b = flatVisible.findIndex((f) => f.id === n.id)
      if (a >= 0 && b >= 0) ids = flatVisible.slice(Math.min(a, b), Math.max(a, b) + 1).map((f) => f.id)
    }
    if (!e.shiftKey) lastClicked.current = n.id
    setMulti(ids)
    navigate({ kind: 'view', view: { type: 'folder', ids, recursive: true } })
  }
  const render = (list: FolderNode[], depth: number): ReactNode =>
    list.map((n) => {
      const kids = children.get(n.id) ?? []
      const open = isOpen(n)
      const active = activeIds.includes(n.id)
      return (
        <div key={n.id}>
          <Item
            indent={depth}
            icon={n.offline ? WifiOff : active ? FolderOpen : Folder}
            label={n.name}
            count={totals.get(n.id)}
            active={active}
            dim={n.offline}
            title={n.offline ? `${n.path}\nThis folder isn’t available — is the drive connected?` : n.path}
            onClick={(e) => click(e, n)}
            onContextMenu={(e) => {
              e.preventDefault()
              const ids = activeIds.includes(n.id) && activeIds.length > 1 ? activeIds : [n.id]
              actions.folderContextMenu(ids, e.clientX, e.clientY)
            }}
            trailing={
              <>
                {n.isRoot && !n.inLibrary && !n.offline && (
                  <Tooltip label="Kept in its original location">
                    <Link2 size={11} className="text-fg-3 opacity-0 group-hover:opacity-100 shrink-0" />
                  </Tooltip>
                )}
                {kids.length > 0 && (
                  <button
                    aria-label={open ? 'Collapse' : 'Expand'}
                    className="absolute h-5 w-4 flex items-center justify-center text-fg-3 hover:text-fg"
                    style={{ left: depth * 14 - 3 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(n.id)
                    }}
                  >
                    <ChevronRight size={11} className={cx('transition-transform duration-150', open && 'rotate-90')} />
                  </button>
                )}
              </>
            }
          />
          {open && kids.length > 0 && render(kids, depth + 1)}
        </div>
      )
    })
  return <>{render(children.get(null) ?? [], 0)}</>
}

function Activity() {
  const a = useApp((s) => s.activity)
  const imp = a.import
  const proc = a.processing
  if (!imp && proc.total === 0 && !a.task) return null
  let label = ''
  let detail = ''
  let progress = 0
  if (imp) {
    if (imp.phase === 'scanning') {
      label = 'Looking for photos…'
      detail = `${imp.found.toLocaleString()} found`
      progress = 0
    } else {
      label = 'Importing…'
      detail = `${imp.processed.toLocaleString()} / ${imp.found.toLocaleString()}`
      progress = imp.found ? imp.processed / imp.found : 0
    }
    if (imp.queued) detail += ` · ${imp.queued} more queued`
  } else if (a.task) {
    label = a.task.label
    detail = `${a.task.done.toLocaleString()} / ${a.task.total.toLocaleString()}`
    progress = a.task.total ? a.task.done / a.task.total : 0
  } else {
    label = proc.paused ? 'Processing paused' : 'Creating thumbnails…'
    detail = `${proc.done.toLocaleString()} / ${proc.total.toLocaleString()}`
    progress = proc.total ? proc.done / proc.total : 0
  }
  return (
    <div className="mx-3 mb-2 p-3 rounded-lg bg-hover anim-fade" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-medium text-fg flex-1 truncate">{label}</span>
        {imp ? (
          <IconButton icon={X} label="Stop import" size={13} className="h-5! w-5!" onClick={() => void call('import.cancel')} />
        ) : !a.task ? (
          <IconButton icon={proc.paused ? Play : Pause} label={proc.paused ? 'Resume' : 'Pause'} size={13} className="h-5! w-5!" onClick={() => void call('activity.setPaused', !proc.paused)} />
        ) : null}
      </div>
      <div className="text-[11.5px] text-fg-3 tabular mt-0.5 mb-2">{detail}</div>
      <ProgressBar value={progress} />
      {imp && proc.total > 0 && <div className="text-[11px] text-fg-3 tabular mt-1.5">Thumbnails {proc.done.toLocaleString()} / {proc.total.toLocaleString()}</div>}
    </div>
  )
}

export function Sidebar() {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const counts = useApp((s) => s.counts)
  const albums = useApp((s) => s.albums)
  const tags = useApp((s) => s.tags)
  const folders = useApp((s) => s.folders)
  const prefs = useApp((s) => s.prefs)!
  const setPrefs = useApp((s) => s.setPrefs)
  const library = useApp((s) => s.library)
  const [showAllTags, setShowAllTags] = useState(false)
  const resizing = useRef(false)

  const is = (v: ViewSpec): boolean => route.kind === 'view' && sameView(route.view, v)
  const go = (r: Route) => () => navigate(r)
  const view = (v: ViewSpec) => () => navigate({ kind: 'view', view: v })

  const onResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    resizing.current = true
    const startX = e.clientX
    const startW = prefs.sidebarWidth
    const move = (ev: MouseEvent): void => {
      const w = Math.max(190, Math.min(420, startW + ev.clientX - startX))
      useApp.setState((s) => ({ prefs: s.prefs ? { ...s.prefs, sidebarWidth: w } : s.prefs }))
    }
    const up = (): void => {
      resizing.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      const w = useApp.getState().prefs?.sidebarWidth ?? startW
      setPrefs({ sidebarWidth: w })
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (prefs.sidebarCollapsed) return null
  const visibleTags = showAllTags ? tags : tags.slice(0, 12)

  return (
    <aside
      className="relative h-full shrink-0 flex flex-col bg-sidebar border-r border-line"
      style={{ width: prefs.sidebarWidth }}
      aria-label="Sidebar"
    >
      <div className={cx('drag-region h-12 shrink-0 flex items-center gap-2', isMac ? 'pl-[84px] pr-2' : 'pl-4 pr-2')}>
        {!isMac && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-5 w-5 rounded-md bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_55%,#000)] shadow-sm shrink-0" />
            <span className="font-semibold text-[13px] tracking-[-0.01em] truncate" title={library?.path}>{library?.name}</span>
          </div>
        )}
        <div className="ml-auto">
          <IconButton icon={PanelLeftClose} label={`Hide sidebar (${isMac ? '⌘' : 'Ctrl'}\\)`} onClick={() => setPrefs({ sidebarCollapsed: true })} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scroll pb-3" aria-label="Library navigation">
        <Section id="library" title="Library">
          <Item icon={Images} label="All Media" count={counts.all} active={is({ type: 'all' })} onClick={view({ type: 'all' })} />
          <Item icon={ImageIcon} label="Photos" count={counts.photos} active={is({ type: 'photos' })} onClick={view({ type: 'photos' })} />
          <Item icon={Film} label="Videos" count={counts.videos} active={is({ type: 'videos' })} onClick={view({ type: 'videos' })} />
          <Item
            icon={Heart}
            label="Favorites"
            count={counts.favorites}
            active={is({ type: 'favorites' })}
            onClick={view({ type: 'favorites' })}
            drop={{ onMedia: (ids) => void call('media.setFavorite', ids, true).then(() => toast(`Added ${count(ids.length, 'item')} to Favorites`)) }}
          />
          <Item icon={Clock} label="Recently Added" active={is({ type: 'recent-added' })} onClick={view({ type: 'recent-added' })} />
          <Item icon={History} label="Recently Viewed" active={is({ type: 'recent-viewed' })} onClick={view({ type: 'recent-viewed' })} />
          <Item icon={CalendarDays} label="Timeline" active={is({ type: 'timeline' })} onClick={view({ type: 'timeline' })} />
        </Section>

        <Section
          id="albums"
          title="Albums"
          action={<IconButton icon={Plus} label="New album" size={14} className="h-6! w-6!" onClick={() => void actions.newAlbum()} />}
        >
          {albums.length === 0 && <NewAlbumDrop />}
          {albums.map((a: Album) => (
            <Item
              key={a.id}
              icon={Images}
              thumb={a.coverId ? thumbUrl(a.coverId) : null}
              label={a.name}
              count={a.count}
              active={is({ type: 'album', id: a.id })}
              onClick={view({ type: 'album', id: a.id })}
              onDoubleClick={() => void actions.renameAlbum(a)}
              onContextMenu={(e) => {
                e.preventDefault()
                actions.albumContextMenu(a, e.clientX, e.clientY)
              }}
              drop={{ onMedia: (ids) => void actions.addToAlbum(a.id, ids), onFiles: (paths) => void actions.startImport(paths, { albumId: a.id }) }}
            />
          ))}
          {albums.length > 0 && <NewAlbumDrop compact />}
        </Section>

        {tags.length > 0 && (
          <Section id="tags" title="Tags">
            {visibleTags.map((t) => (
              <Item
                key={t.id}
                icon={Hash}
                label={t.name}
                count={t.count}
                active={is({ type: 'tag', id: t.id })}
                onClick={view({ type: 'tag', id: t.id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  actions.tagContextMenu(t, e.clientX, e.clientY)
                }}
                drop={{ onMedia: (ids) => void call('tags.add', ids, [t.name]).then(() => toast(`Tagged ${count(ids.length, 'item')} #${t.name}`)) }}
              />
            ))}
            {tags.length > 12 && (
              <button className="mx-2 px-2.5 h-7 text-[12px] text-fg-3 hover:text-fg-2" onClick={() => setShowAllTags(!showAllTags)}>
                {showAllTags ? 'Show fewer' : `Show all ${tags.length}`}
              </button>
            )}
          </Section>
        )}

        {folders.length > 0 && (
          <Section id="folders" title="Folders">
            <FolderTree nodes={folders} />
          </Section>
        )}

        <Section id="tools" title="Tools">
          <Item
            icon={LayoutGrid}
            label="Collage Studio"
            active={route.kind === 'collage'}
            onClick={go({ kind: 'collage' })}
            drop={{ onMedia: (ids) => actions.openCollage(ids) }}
          />
          <Item
            icon={Repeat}
            label="Image Converter"
            active={route.kind === 'converter'}
            onClick={go({ kind: 'converter' })}
            drop={{
              onMedia: (ids) => void actions.openConverter(ids),
              onFiles: async (paths) => {
                const items = await call('convert.expand', paths)
                useUI.setState({ converterItems: items })
                navigate({ kind: 'converter' })
              }
            }}
          />
          <Item icon={Copy} label="Duplicates" active={route.kind === 'duplicates'} onClick={go({ kind: 'duplicates' })} />
        </Section>
      </nav>

      <Activity />
      <div className="border-t border-line py-2 space-y-px">
        <Item
          icon={Trash2}
          label="Recently Deleted"
          count={counts.deleted}
          active={is({ type: 'deleted' })}
          onClick={view({ type: 'deleted' })}
          drop={{ onMedia: (ids) => void actions.trash(ids) }}
        />
        <Item icon={Settings} label="Settings" active={route.kind === 'settings'} onClick={go({ kind: 'settings' })} />
      </div>
      <div
        className="absolute top-0 right-[-3px] w-[6px] h-full cursor-col-resize z-10 hover:bg-accent/40 transition-colors"
        onMouseDown={onResizeStart}
        onDoubleClick={() => setPrefs({ sidebarWidth: 232 })}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
      {library && (
        <div className="px-4 pb-2 -mt-1 flex items-center gap-1.5 text-[11px] text-fg-3 truncate" title={library.path}>
          <HardDrive size={11} className="shrink-0" />
          <span className="truncate">{isMac ? library.name : library.path}</span>
        </div>
      )}
    </aside>
  )
}

function NewAlbumDrop({ compact }: { compact?: boolean }) {
  const dragActive = useUI((s) => s.dragActive)
  const { over, handlers } = useDropTarget({ onMedia: (ids) => void actions.newAlbum(ids) })
  if (compact && dragActive !== 'media') return null
  return (
    <div
      {...handlers}
      role="button"
      tabIndex={0}
      onClick={() => void actions.newAlbum()}
      className={cx(
        'mx-2 px-2.5 h-[30px] rounded-md flex items-center gap-2.5 text-[12.5px] border border-dashed transition-colors',
        over ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong text-fg-3 hover:text-fg-2 hover:border-fg-3'
      )}
    >
      <Plus size={14} />
      {dragActive === 'media' ? 'Drop to create an album' : 'New album'}
    </div>
  )
}
