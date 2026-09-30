// Renders a collage to a canvas at export resolution.

import type { MediaItem } from '@shared/types'
import { needsPreview } from '@shared/formats'
import { aspectRatio, coverPlacement, FONTS, layoutTree, type CollageState, type Rect } from './model'

export function sourceUrl(m: MediaItem): string {
  return m.kind === 'photo' && needsPreview(m.ext) ? `loupe://preview/${m.id}` : `loupe://media/${m.id}`
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Couldn’t load ${url}`))
      img.src = url
    })
    imageCache.set(url, p)
    p.catch(() => imageCache.delete(url))
  }
  return p
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rr = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, rr)
}

/** Draw an image covering rect `r` with zoom/pan and a quarter-turn rotation. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: Rect, rotation: number, zoom: number, panX: number, panY: number): void {
  const swap = rotation % 180 !== 0
  const iw = img.naturalWidth, ih = img.naturalHeight
  const ratio = swap ? ih / iw : iw / ih
  const p = coverPlacement(r, ratio, zoom, panX, panY)
  ctx.save()
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  const dw = swap ? p.h : p.w
  const dh = swap ? p.w : p.h
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
}

export function exportSize(aspect: string, longEdge: number): { w: number; h: number } {
  const r = aspectRatio(aspect)
  return r >= 1 ? { w: longEdge, h: Math.round(longEdge / r) } : { w: Math.round(longEdge * r), h: longEdge }
}

export async function renderCollage(s: CollageState, items: Map<number, MediaItem>, longEdge: number): Promise<HTMLCanvasElement> {
  const { w: W, h: H } = exportSize(s.aspect, longEdge)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const unit = Math.min(W, H)

  // Background
  ctx.fillStyle = s.background.color
  ctx.fillRect(0, 0, W, H)
  if (s.background.mediaId !== null) {
    const m = items.get(s.background.mediaId)
    if (m) {
      const img = await loadImage(sourceUrl(m))
      ctx.save()
      if (s.background.blur > 0) ctx.filter = `blur(${(s.background.blur / 1000) * unit}px)`
      const bleed = s.background.blur > 0 ? (s.background.blur / 400) * unit : 0
      drawCover(ctx, img, { x: -bleed, y: -bleed, w: W + bleed * 2, h: H + bleed * 2 }, m.rotation, 1, 0, 0)
      ctx.restore()
    }
  }

  const radius = s.radius * unit
  const border = s.borderWidth * unit
  const drawTile = async (r: Rect, mediaId: number | null, zoom: number, panX: number, panY: number): Promise<void> => {
    if (s.shadow > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${0.18 + s.shadow * 0.32})`
      ctx.shadowBlur = s.shadow * unit * 0.04
      ctx.shadowOffsetY = s.shadow * unit * 0.012
      roundRect(ctx, r, radius)
      ctx.fillStyle = s.background.color
      ctx.fill()
      ctx.restore()
    }
    ctx.save()
    roundRect(ctx, r, radius)
    ctx.clip()
    if (mediaId !== null && items.get(mediaId)) {
      const m = items.get(mediaId)!
      const img = await loadImage(sourceUrl(m))
      drawCover(ctx, img, r, m.rotation, zoom, panX, panY)
    } else {
      ctx.fillStyle = 'rgba(128,128,128,0.15)'
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    ctx.restore()
    if (border > 0) {
      ctx.save()
      roundRect(ctx, { x: r.x + border / 2, y: r.y + border / 2, w: r.w - border, h: r.h - border }, Math.max(0, radius - border / 2))
      ctx.lineWidth = border
      ctx.strokeStyle = s.borderColor
      ctx.stroke()
      ctx.restore()
    }
  }

  if (s.template === 'free') {
    for (const f of [...s.free].sort((a, b) => a.z - b.z)) {
      await drawTile({ x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }, f.mediaId, 1, 0, 0)
    }
  } else {
    const m = s.margin * unit
    const gap = s.spacing * unit
    const { cells } = layoutTree(s.tree, { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, gap)
    for (const [id, r] of cells) {
      const c = s.cells[id]
      await drawTile(r, c?.mediaId ?? null, c?.zoom ?? 1, c?.panX ?? 0, c?.panY ?? 0)
    }
  }

  for (const t of s.texts) {
    const size = t.size * H
    ctx.save()
    ctx.font = `${t.font === 'display' ? 800 : t.weight} ${size}px ${FONTS[t.font].css}`
    ctx.textAlign = t.align
    ctx.textBaseline = 'middle'
    ctx.fillStyle = t.color
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = size * 0.25
      ctx.shadowOffsetY = size * 0.05
    }
    const lines = t.text.split('\n')
    const lh = size * 1.2
    lines.forEach((line, i) => ctx.fillText(line, t.x * W, t.y * H + (i - (lines.length - 1) / 2) * lh))
    ctx.restore()
  }
  return canvas
}

export function canvasToBytes(canvas: HTMLCanvasElement, format: 'jpeg' | 'png' | 'webp', quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Export failed'))
        void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)))
      },
      `image/${format}`,
      format === 'png' ? undefined : quality / 100
    )
  })
}
