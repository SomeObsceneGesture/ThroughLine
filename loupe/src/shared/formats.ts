// File format knowledge shared by main and renderer.

import type { MediaKind } from './types'

/** Formats Chromium can display natively in an <img>. */
export const BROWSER_IMAGE = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'ico'])

/** Formats libvips (sharp) decodes directly. */
export const SHARP_IMAGE = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'svg'])

export const HEIF_IMAGE = new Set(['heic', 'heif', 'hif'])

export const RAW_IMAGE = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'raf',
  'pef', 'srw', 'x3f', '3fr', 'iiq', 'rwl', 'erf', 'mef', 'mos', 'kdc', 'dcr', 'raw'
])

export const OTHER_IMAGE = new Set(['bmp', 'ico'])

export const VIDEO = new Set([
  'mp4', 'm4v', 'mov', 'qt', 'mkv', 'webm', 'avi', 'wmv', 'mpg', 'mpeg', 'm2ts', 'mts', 'ts', '3gp', '3g2', 'flv', 'ogv'
])

/** Video containers Chromium usually demuxes itself (codec permitting). */
export const BROWSER_VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'])

export const IMAGE_EXTENSIONS = new Set([...SHARP_IMAGE, ...HEIF_IMAGE, ...RAW_IMAGE, ...OTHER_IMAGE])

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function kindOfExt(ext: string): MediaKind | null {
  if (IMAGE_EXTENSIONS.has(ext)) return 'photo'
  if (VIDEO.has(ext)) return 'video'
  return null
}

export function isSupportedPath(p: string): boolean {
  return kindOfExt(extOf(p)) !== null
}

/** Whether the viewer needs a generated preview instead of the original file. */
export function needsPreview(ext: string): boolean {
  return !BROWSER_IMAGE.has(ext)
}

export function formatLabel(ext: string): string {
  switch (ext) {
    case 'jpg': case 'jpeg': case 'jpe': case 'jfif': return 'JPEG'
    case 'tif': case 'tiff': return 'TIFF'
    case 'heic': case 'heif': case 'hif': return 'HEIC'
    case 'm4v': return 'MP4'
    case 'qt': return 'MOV'
    default: return RAW_IMAGE.has(ext) ? `${ext.toUpperCase()} (RAW)` : ext.toUpperCase()
  }
}

export const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg', avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', m2ts: 'video/mp2t',
  mts: 'video/mp2t', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', flv: 'video/x-flv'
}

export function mimeOf(ext: string): string {
  return MIME[ext] ?? 'application/octet-stream'
}
