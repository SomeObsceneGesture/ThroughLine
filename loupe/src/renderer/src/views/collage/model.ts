// Collage data model. Grid templates are split trees, so every gutter can be
// dragged to resize neighbouring cells; freeform collages are absolutely
// positioned items. All geometry is normalised (0–1) so the same state renders
// at preview size and at export resolution.

export type Leaf = { kind: 'cell'; id: string }
export type Split = { kind: 'split'; dir: 'row' | 'col'; sizes: number[]; children: TreeNode[] }
export type TreeNode = Leaf | Split

export interface CellContent {
  mediaId: number | null
  zoom: number
  panX: number
  panY: number
}

export interface FreeItem {
  id: string
  mediaId: number
  x: number
  y: number
  w: number
  h: number
  z: number
}

export interface TextLayer {
  id: string
  text: string
  x: number
  y: number
  size: number
  color: string
  font: 'sans' | 'serif' | 'mono' | 'display'
  weight: 400 | 600 | 800
  align: 'left' | 'center' | 'right'
  shadow: boolean
}

export interface Background {
  color: string
  mediaId: number | null
  blur: number
}

export interface CollageState {
  template: string
  tree: TreeNode
  cells: Record<string, CellContent>
  free: FreeItem[]
  aspect: string
  spacing: number
  margin: number
  radius: number
  borderWidth: number
  borderColor: string
  shadow: number
  background: Background
  texts: TextLayer[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

let seq = 0
export const uid = (p = 'c'): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

const c = (): Leaf => ({ kind: 'cell', id: uid() })
const row = (...children: TreeNode[]): Split => ({ kind: 'split', dir: 'row', sizes: children.map(() => 1 / children.length), children })
const col = (...children: TreeNode[]): Split => ({ kind: 'split', dir: 'col', sizes: children.map(() => 1 / children.length), children })
const weighted = (s: Split, sizes: number[]): Split => ({ ...s, sizes: sizes.map((v) => v / sizes.reduce((a, b) => a + b, 0)) })

export interface Template {
  id: string
  count: number
  label: string
  build: () => TreeNode | null
}

export const TEMPLATES: Template[] = [
  { id: '1', count: 1, label: 'Single', build: () => c() },
  { id: '2h', count: 2, label: 'Side by side', build: () => row(c(), c()) },
  { id: '2v', count: 2, label: 'Stacked', build: () => col(c(), c()) },
  { id: '3l', count: 3, label: 'Feature left', build: () => weighted(row(c(), col(c(), c())), [3, 2]) },
  { id: '3t', count: 3, label: 'Feature top', build: () => weighted(col(c(), row(c(), c())), [3, 2]) },
  { id: '3h', count: 3, label: 'Three columns', build: () => row(c(), c(), c()) },
  { id: '4g', count: 4, label: 'Grid', build: () => col(row(c(), c()), row(c(), c())) },
  { id: '4l', count: 4, label: 'Feature + 3', build: () => weighted(row(c(), col(c(), c(), c())), [2, 1]) },
  { id: '4t', count: 4, label: 'Banner + 3', build: () => weighted(col(c(), row(c(), c(), c())), [3, 2]) },
  { id: '5', count: 5, label: 'Two over three', build: () => col(row(c(), c()), row(c(), c(), c())) },
  { id: '6g', count: 6, label: '3 × 2', build: () => col(row(c(), c(), c()), row(c(), c(), c())) },
  { id: '6v', count: 6, label: '2 × 3', build: () => col(row(c(), c()), row(c(), c()), row(c(), c())) },
  { id: '6f', count: 6, label: 'Feature + 5', build: () => weighted(col(weighted(row(c(), col(c(), c())), [2, 1]), row(c(), c(), c())), [2, 1]) },
  { id: '9g', count: 9, label: '3 × 3', build: () => col(row(c(), c(), c()), row(c(), c(), c()), row(c(), c(), c())) },
  { id: 'free', count: 0, label: 'Freeform', build: () => null }
]

export const ASPECTS: { id: string; label: string; ratio: number }[] = [
  { id: '1:1', label: 'Square 1:1', ratio: 1 },
  { id: '4:5', label: 'Portrait 4:5', ratio: 4 / 5 },
  { id: '3:4', label: 'Portrait 3:4', ratio: 3 / 4 },
  { id: '2:3', label: 'Portrait 2:3', ratio: 2 / 3 },
  { id: '9:16', label: 'Story 9:16', ratio: 9 / 16 },
  { id: '3:2', label: 'Landscape 3:2', ratio: 3 / 2 },
  { id: '4:3', label: 'Landscape 4:3', ratio: 4 / 3 },
  { id: '16:9', label: 'Widescreen 16:9', ratio: 16 / 9 },
  { id: 'a4p', label: 'A4 portrait', ratio: 210 / 297 },
  { id: 'a4l', label: 'A4 landscape', ratio: 297 / 210 }
]

export function aspectRatio(id: string): number {
  return ASPECTS.find((a) => a.id === id)?.ratio ?? 1
}

export function leaves(n: TreeNode): string[] {
  return n.kind === 'cell' ? [n.id] : n.children.flatMap(leaves)
}

export function initialState(mediaIds: number[]): CollageState {
  const count = Math.max(1, Math.min(9, mediaIds.length || 4))
  const best = [...TEMPLATES].filter((t) => t.count > 0).sort((a, b) => Math.abs(a.count - count) - Math.abs(b.count - count) || b.count - a.count)[0]
  const tree = best.build()!
  const cells: Record<string, CellContent> = {}
  leaves(tree).forEach((id, i) => (cells[id] = { mediaId: mediaIds[i] ?? null, zoom: 1, panX: 0, panY: 0 }))
  return {
    template: best.id,
    tree,
    cells,
    free: [],
    aspect: count === 2 ? '3:2' : count === 3 ? '4:3' : '1:1',
    spacing: 0.012,
    margin: 0.012,
    radius: 0.01,
    borderWidth: 0,
    borderColor: '#ffffff',
    shadow: 0,
    background: { color: '#ffffff', mediaId: null, blur: 24 },
    texts: []
  }
}

/** Apply a new template, carrying photos over in order. */
export function applyTemplate(s: CollageState, templateId: string): CollageState {
  const t = TEMPLATES.find((x) => x.id === templateId)
  if (!t) return s
  const current = leaves(s.tree).map((id) => s.cells[id]?.mediaId).filter((m): m is number => m !== null && m !== undefined)
  const freeMedia = s.free.map((f) => f.mediaId)
  const media = [...current, ...freeMedia.filter((m) => !current.includes(m))]
  if (templateId === 'free') {
    const items: FreeItem[] = media.slice(0, 12).map((mediaId, i) => {
      const cols = Math.ceil(Math.sqrt(Math.max(1, media.length)))
      const w = 0.8 / cols
      return { id: uid('f'), mediaId, x: 0.1 + (i % cols) * w + 0.02 * (i % 2), y: 0.1 + Math.floor(i / cols) * w + 0.02, w: w * 0.95, h: w * 0.95, z: i }
    })
    return { ...s, template: 'free', free: items }
  }
  const tree = t.build()!
  const cells: Record<string, CellContent> = {}
  leaves(tree).forEach((id, i) => (cells[id] = { mediaId: media[i] ?? null, zoom: 1, panX: 0, panY: 0 }))
  return { ...s, template: templateId, tree, cells, free: [] }
}

export interface Gutter {
  path: number[]
  index: number
  dir: 'row' | 'col'
  rect: Rect
  span: number
}

/** Cell rectangles and draggable gutters for a split tree inside `r`. */
export function layoutTree(node: TreeNode, r: Rect, gap: number, path: number[] = [], out = { cells: new Map<string, Rect>(), gutters: [] as Gutter[] }) {
  if (node.kind === 'cell') {
    out.cells.set(node.id, r)
    return out
  }
  const total = node.dir === 'row' ? r.w : r.h
  const usable = total - gap * (node.children.length - 1)
  let pos = node.dir === 'row' ? r.x : r.y
  node.children.forEach((child, i) => {
    const size = usable * node.sizes[i]
    const cr = node.dir === 'row' ? { x: pos, y: r.y, w: size, h: r.h } : { x: r.x, y: pos, w: r.w, h: size }
    layoutTree(child, cr, gap, [...path, i], out)
    pos += size
    if (i < node.children.length - 1) {
      out.gutters.push({
        path,
        index: i,
        dir: node.dir,
        rect: node.dir === 'row' ? { x: pos, y: r.y, w: gap, h: r.h } : { x: r.x, y: pos, w: r.w, h: gap },
        span: usable
      })
      pos += gap
    }
  })
  return out
}

export function resizeAt(tree: TreeNode, path: number[], index: number, delta: number): TreeNode {
  if (tree.kind === 'cell') return tree
  if (path.length === 0) {
    const sizes = [...tree.sizes]
    const a = sizes[index] + delta
    const b = sizes[index + 1] - delta
    const min = 0.08
    if (a < min || b < min) return tree
    sizes[index] = a
    sizes[index + 1] = b
    return { ...tree, sizes }
  }
  const [head, ...rest] = path
  const children = tree.children.map((ch, i) => (i === head ? resizeAt(ch, rest, index, delta) : ch))
  return { ...tree, children }
}

/** Where to draw an image of aspect `imgRatio` inside `r`, covering it, with zoom and pan. */
export function coverPlacement(r: Rect, imgRatio: number, zoom: number, panX: number, panY: number): Rect {
  const cellRatio = r.w / r.h
  let w: number, h: number
  if (imgRatio > cellRatio) {
    h = r.h * zoom
    w = h * imgRatio
  } else {
    w = r.w * zoom
    h = w / imgRatio
  }
  const ox = (w - r.w) / 2
  const oy = (h - r.h) / 2
  return { x: r.x - ox + panX * ox, y: r.y - oy + panY * oy, w, h }
}

export const FONTS: Record<TextLayer['font'], { label: string; css: string }> = {
  sans: { label: 'Sans', css: "'Inter Variable', system-ui, sans-serif" },
  serif: { label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  display: { label: 'Display', css: "'Inter Variable', system-ui, sans-serif" }
}

export const SWATCHES = ['#ffffff', '#f5f1ea', '#e9e4dc', '#d9e2d3', '#dde6ef', '#f3dfe0', '#2b2b2f', '#111111', '#1f2a44', '#3b4a3a']
