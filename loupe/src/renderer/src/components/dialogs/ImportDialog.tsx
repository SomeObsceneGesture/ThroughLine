import { useEffect, useState } from 'react'
import { Copy, Link2, Film, Image as ImageIcon, FolderTree } from 'lucide-react'
import type { ImportMode, ScanPreview } from '@shared/types'
import { Button, Checkbox, Modal, Spinner } from '../ui/controls'
import { DialogFooter } from './common'
import { call } from '../../lib/api'
import { bytes, fileName } from '../../lib/format'
import { cx } from '../../lib/cx'

export function ImportDialog({ paths, defaultMode, albumName, onDone }: { paths: string[]; defaultMode: ImportMode; albumName?: string; onDone: (r: { mode: ImportMode; remember: boolean } | null) => void }) {
  const [preview, setPreview] = useState<ScanPreview | null>(null)
  const [mode, setMode] = useState<ImportMode>(defaultMode)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    let live = true
    call('import.preview', paths).then((p) => live && setPreview(p)).catch(() => live && setPreview({ files: 0, photos: 0, videos: 0, folders: 0, bytes: 0, unsupported: 0, truncated: false, inLibrary: false }))
    return () => {
      live = false
    }
  }, [paths])

  const what =
    paths.length === 1 ? `“${fileName(paths[0])}”` : `${paths.length.toLocaleString()} items`
  const nothing = preview && preview.files === 0

  const Option = ({ value, icon: Icon, title, body }: { value: ImportMode; icon: typeof Copy; title: string; body: string }) => (
    <button
      role="radio"
      aria-checked={mode === value}
      onClick={() => setMode(value)}
      onDoubleClick={() => onDone({ mode: value, remember })}
      className={cx(
        'flex-1 text-left p-4 rounded-xl border transition-all duration-150',
        mode === value ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong hover:bg-hover'
      )}
    >
      <div className={cx('h-8 w-8 rounded-lg flex items-center justify-center mb-3', mode === value ? 'bg-accent text-accent-fg' : 'bg-active text-fg-2')}>
        <Icon size={16} />
      </div>
      <div className="font-semibold text-[13.5px]">{title}</div>
      <div className="text-[12.5px] text-fg-2 mt-1 leading-relaxed">{body}</div>
    </button>
  )

  return (
    <Modal onClose={() => onDone(null)} width={560} labelledBy="dialog-title">
      <div className="px-6 pt-6">
        <h2 id="dialog-title" className="text-[16px] font-semibold tracking-[-0.01em]">
          Add {what} to {albumName ? `“${albumName}”` : 'your library'}
        </h2>
        <div className="mt-2 h-5 text-[12.5px] text-fg-2 flex items-center gap-3">
          {!preview ? (
            <span className="flex items-center gap-2"><Spinner size={13} /> Looking for photos and videos…</span>
          ) : nothing ? (
            <span className="text-warning">No supported photos or videos were found{preview.unsupported ? ` (${preview.unsupported.toLocaleString()} other files skipped)` : ''}.</span>
          ) : (
            <>
              {preview.photos > 0 && <span className="flex items-center gap-1"><ImageIcon size={13} /> {preview.photos.toLocaleString()}{preview.truncated ? '+' : ''} photos</span>}
              {preview.videos > 0 && <span className="flex items-center gap-1"><Film size={13} /> {preview.videos.toLocaleString()}{preview.truncated ? '+' : ''} videos</span>}
              {preview.folders > 1 && <span className="flex items-center gap-1"><FolderTree size={13} /> {preview.folders.toLocaleString()} folders</span>}
              <span className="text-fg-3">{bytes(preview.bytes)}{preview.truncated ? '+' : ''}</span>
            </>
          )}
        </div>
      </div>
      <div role="radiogroup" className="px-6 pt-5 flex gap-3">
        <Option value="copy" icon={Copy} title="Copy into library" body="Files are copied into your library folder. The originals stay where they are, untouched." />
        <Option value="reference" icon={Link2} title="Keep in current location" body="Nothing is copied or moved. Loupe organises the files where they already are." />
      </div>
      <div className="px-6 pt-4 text-[12px] text-fg-3 leading-relaxed">
        {mode === 'copy'
          ? preview && preview.bytes > 0
            ? `Uses about ${bytes(preview.bytes)} of space on the library drive. Folder structure is preserved.`
            : 'Folder structure is preserved inside the library’s Originals folder.'
          : 'If these files are on an external drive, they’ll be unavailable while it’s disconnected. Thumbnails stay browsable.'}
      </div>
      <DialogFooter>
        <div className="mr-auto self-center">
          <Checkbox checked={remember} onChange={setRemember} label={<span className="text-fg-2 text-[12.5px]">Always do this</span>} />
        </div>
        <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
        <Button variant="primary" className="primary-action" disabled={!!nothing} onClick={() => onDone({ mode, remember })} data-autofocus>
          Import
        </Button>
      </DialogFooter>
    </Modal>
  )
}
