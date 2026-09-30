import { ImagePlus, FolderPlus, Heart, Images, Search, Trash2, History, Film, Image as ImageIcon, WifiOff } from 'lucide-react'
import type { ViewSpec } from '@shared/types'
import { Button } from '../ui/controls'
import { useApp } from '../../store/app'
import { useGallery } from '../../store/gallery'
import * as actions from '../../lib/actions'
import { useDropTarget } from '../../lib/dnd'
import { cx } from '../../lib/cx'
import { mod } from '../../lib/api'

export function EmptyState({ view }: { view: ViewSpec }) {
  const search = useGallery((s) => s.search)
  const counts = useApp((s) => s.counts)
  const justCreated = useApp((s) => s.justCreated)
  const folders = useApp((s) => s.folders)
  const navigate = useApp((s) => s.navigate)
  const albumDrop = useDropTarget(
    view.type === 'album'
      ? { onMedia: (ids) => void actions.addToAlbum(view.id, ids), onFiles: (paths) => void actions.startImport(paths, { albumId: view.id }) }
      : {}
  )

  if (search.trim()) {
    const scoped = !['all', 'timeline'].includes(view.type)
    return (
      <Shell icon={Search} title={`No results for “${search.trim()}”`} body="Try a filename, folder, tag, album, camera, year or month — for example “beach 2026” or “#family”.">
        {scoped && (
          <Button onClick={() => navigate({ kind: 'view', view: { type: 'all' } })}>Search All Media</Button>
        )}
        <Button variant="ghost" onClick={() => { useGallery.getState().setSearch(''); void useGallery.getState().reload() }}>Clear Search</Button>
      </Shell>
    )
  }

  if (counts.all === 0 && ['all', 'timeline', 'photos', 'videos', 'recent-added'].includes(view.type)) {
    return (
      <Shell
        big
        icon={ImagePlus}
        title={justCreated ? 'Your library is ready' : 'Your library is empty'}
        body={justCreated ? 'Drag photos or folders here to begin.' : 'Drag photos or folders here to get started.'}
        hint={`Or press ${mod} O. Folders are imported with all their subfolders.`}
      >
        <Button variant="primary" size="lg" icon={ImagePlus} onClick={() => void actions.importViaPicker(false)}>Import Media</Button>
        <Button size="lg" icon={FolderPlus} onClick={() => void actions.importViaPicker(true)}>Import Folder</Button>
      </Shell>
    )
  }

  switch (view.type) {
    case 'album':
      return (
        <div {...albumDrop.handlers} className="flex-1 flex">
          <Shell icon={Images} title="This album is empty" body="Drag photos here to add them — from the library, or straight from your computer." highlight={albumDrop.over}>
            <Button onClick={() => navigate({ kind: 'view', view: { type: 'all' } })}>Browse All Media</Button>
          </Shell>
        </div>
      )
    case 'favorites':
      return <Shell icon={Heart} title="No favorites yet" body="Press F, or click the heart on any photo or video, and it’ll appear here." />
    case 'deleted':
      return <Shell icon={Trash2} title="Nothing in Recently Deleted" body="Items you delete wait here until you remove them permanently, so you can always change your mind." />
    case 'recent-viewed':
      return <Shell icon={History} title="Nothing viewed yet" body="Photos and videos you open in the viewer will show up here." />
    case 'videos':
      return <Shell icon={Film} title="No videos yet" body="Videos you import — MP4, MOV, MKV, WebM and more — will appear here." />
    case 'photos':
      return <Shell icon={ImageIcon} title="No photos yet" body="Photos you import will appear here." />
    case 'folder': {
      const offline = folders.filter((f) => view.ids.includes(f.id)).some((f) => f.offline)
      return offline ? (
        <Shell icon={WifiOff} title="This folder isn’t available" body="It’s probably on a drive that isn’t connected right now. Connect it and try again, or use Relocate Folder from the right-click menu if it has moved." />
      ) : (
        <Shell icon={FolderPlus} title="No media in this folder" body="Use “Check for New Files” in the folder’s right-click menu to pick up anything added since the import." />
      )
    }
    default:
      return <Shell icon={Images} title="Nothing here yet" body="Items that match this view will appear here." />
  }
}

function Shell({ icon: Icon, title, body, hint, children, big, highlight }: { icon: typeof Images; title: string; body: string; hint?: string; children?: React.ReactNode; big?: boolean; highlight?: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        className={cx(
          'flex flex-col items-center text-center max-w-[440px] anim-up rounded-3xl transition-colors',
          big ? 'px-14 py-12 border-2 border-dashed border-line-strong' : 'px-8 py-8',
          highlight && 'border-2 border-dashed border-accent bg-accent-soft'
        )}
      >
        <div className={cx('rounded-2xl bg-hover flex items-center justify-center text-fg-3 mb-5', big ? 'h-16 w-16' : 'h-12 w-12')}>
          <Icon size={big ? 28 : 22} strokeWidth={1.5} />
        </div>
        <h2 className={cx('font-semibold tracking-[-0.02em]', big ? 'text-[22px]' : 'text-[16px]')}>{title}</h2>
        <p className="mt-2 text-[13.5px] text-fg-2 leading-relaxed">{body}</p>
        {children && <div className="mt-6 flex gap-2.5 flex-wrap justify-center">{children}</div>}
        {hint && <p className="mt-5 text-[12px] text-fg-3">{hint}</p>}
      </div>
    </div>
  )
}
