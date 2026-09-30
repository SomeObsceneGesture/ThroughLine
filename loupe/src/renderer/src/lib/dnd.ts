// Drag and drop: media dragged inside the app, and files dragged in from the OS.

import { useRef, useState, type DragEvent } from 'react'
import { pathForFile, thumbUrl } from './api'
import { useUI } from '../store/ui'

export const MEDIA_MIME = 'application/x-loupe-media'

let dragIds: number[] = []

export function isMediaDrag(e: DragEvent | globalThis.DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(MEDIA_MIME)
}

export function isFileDrag(e: DragEvent | globalThis.DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files') && !isMediaDrag(e)
}

export function draggedIds(): number[] {
  return dragIds
}

export function droppedPaths(e: DragEvent | globalThis.DragEvent): string[] {
  return Array.from(e.dataTransfer?.files ?? [])
    .map((f) => pathForFile(f))
    .filter(Boolean)
}

export function startMediaDrag(e: DragEvent, ids: number[], thumbVersions?: Map<number, number>): void {
  dragIds = ids
  e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(ids))
  e.dataTransfer.setData('text/plain', `${ids.length} item${ids.length === 1 ? '' : 's'}`)
  e.dataTransfer.effectAllowed = 'copyMove'
  // A small stack of thumbnails with a count badge.
  const ghost = document.createElement('div')
  ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;width:96px;height:96px;pointer-events:none;'
  ids.slice(0, 3).reverse().forEach((id, i, arr) => {
    const img = document.createElement('img')
    img.src = thumbUrl(id, thumbVersions?.get(id) ?? 0)
    const k = arr.length - 1 - i
    img.style.cssText = `position:absolute;left:${8 + k * 5}px;top:${8 - k * 4}px;width:72px;height:72px;object-fit:cover;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.35);border:2px solid #fff;transform:rotate(${(k - 1) * 4}deg);background:#333;`
    ghost.appendChild(img)
  })
  if (ids.length > 1) {
    const badge = document.createElement('div')
    badge.textContent = String(ids.length)
    badge.style.cssText = 'position:absolute;right:2px;top:0;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:var(--accent);color:#fff;font:600 12px/22px Inter Variable,system-ui;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);'
    ghost.appendChild(badge)
  }
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, 40, 40)
  setTimeout(() => ghost.remove(), 0)
  useUI.setState({ dragActive: 'media' })
}

export function endMediaDrag(): void {
  dragIds = []
  useUI.setState({ dragActive: null })
}

/** Hover state + handlers for an element that accepts media and/or files. */
export function useDropTarget(opts: { onMedia?: (ids: number[]) => void; onFiles?: (paths: string[]) => void; mediaEffect?: 'copy' | 'move' }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const accepts = (e: DragEvent): boolean => (!!opts.onMedia && isMediaDrag(e)) || (!!opts.onFiles && isFileDrag(e))
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current++
        setOver(true)
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = isMediaDrag(e) ? (opts.mediaEffect ?? 'copy') : 'copy'
      },
      onDragLeave: (e: DragEvent) => {
        if (!accepts(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current = 0
        setOver(false)
        if (isMediaDrag(e) && opts.onMedia) {
          let ids = draggedIds()
          if (!ids.length) {
            try {
              ids = JSON.parse(e.dataTransfer.getData(MEDIA_MIME))
            } catch {
              ids = []
            }
          }
          endMediaDrag()
          if (ids.length) opts.onMedia(ids)
        } else if (opts.onFiles) {
          const paths = droppedPaths(e)
          useUI.setState({ dragActive: null })
          if (paths.length) opts.onFiles(paths)
        }
      }
    }
  }
}
