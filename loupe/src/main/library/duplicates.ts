// Duplicate detection. Exact duplicates share size + quick hash and are then
// confirmed with a full content hash. "Similar" photos are found with a 64-bit
// difference hash (dHash) using multi-index hashing, so the comparison stays
// fast for large libraries. Nothing is ever deleted automatically.

import { lib, pool } from '../context'
import { LANE_IMPORT } from '../workers/pool'

import { items } from './media-repo'
import { setActivityTask } from '../import/indexer'
import type { DuplicateGroup, DuplicateScanResult, MediaItem } from '@shared/types'

class UnionFind {
  parent = new Map<number, number>()
  find(x: number): number {
    let root = x
    for (;;) {
      const p = this.parent.get(root)
      if (p === undefined) {
        this.parent.set(root, root)
        break
      }
      if (p === root) break
      root = p
    }
    // Path compression.
    let cur = x
    while (cur !== root) {
      const next: number = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function ignoredPairs(): Set<string> {
  return new Set(lib().db.all<{ a: number; b: number }>('SELECT a, b FROM duplicate_ignores').map((r) => `${r.a}:${r.b}`))
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

function suggestKeep(list: MediaItem[]): number {
  const score = (m: MediaItem): number[] => [(m.width ?? 0) * (m.height ?? 0), m.size, m.inLibrary ? 1 : 0, -m.addedAt]
  return [...list].sort((a, b) => {
    const sa = score(a), sb = score(b)
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i]
    return a.id - b.id
  })[0].id
}

export async function scanDuplicates(opts: { similar: boolean; threshold: number }): Promise<DuplicateScanResult> {
  const t0 = Date.now()
  const l = lib()
  const ignored = ignoredPairs()
  const candidates = l.db.all<{ ids: string }>(
    `SELECT group_concat(id) AS ids FROM media WHERE deleted_at IS NULL AND quick_hash IS NOT NULL
     GROUP BY size, quick_hash HAVING count(*) > 1`
  )
  // Confirm with full hashes (computed once and cached).
  const needHash = l.db.all<{ id: number; path: string; in_library: number }>(
    `SELECT id, path, in_library FROM media WHERE full_hash IS NULL AND id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(candidates.flatMap((c) => c.ids.split(',').map(Number)))
  )
  let hashed = 0
  setActivityTask(needHash.length ? { label: 'Checking for duplicates', done: 0, total: needHash.length } : null)
  await Promise.all(
    needHash.map(async (r) => {
      try {
        const h = await pool().run<string>('hash', { path: l.resolve(r.path, r.in_library) }, LANE_IMPORT)
        l.db.run('UPDATE media SET full_hash = ? WHERE id = ?', h, r.id)
      } catch {
        /* unreadable: skip */
      }
      hashed++
      if (hashed % 10 === 0) setActivityTask({ label: 'Checking for duplicates', done: hashed, total: needHash.length })
    })
  )
  setActivityTask(null)

  const groups: DuplicateGroup[] = []
  const inExact = new Set<number>()
  const exactRows = l.db.all<{ ids: string; full_hash: string }>(
    `SELECT group_concat(id) AS ids, full_hash FROM media WHERE deleted_at IS NULL AND full_hash IS NOT NULL
     GROUP BY full_hash HAVING count(*) > 1`
  )
  for (const row of exactRows) {
    const members = row.ids.split(',').map(Number)
    const uf = new UnionFind()
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++)
        if (!ignored.has(pairKey(members[i], members[j]))) uf.union(members[i], members[j])
    const clusters = new Map<number, number[]>()
    for (const m of members) {
      const r = uf.find(m)
      clusters.set(r, [...(clusters.get(r) ?? []), m])
    }
    for (const c of clusters.values()) {
      if (c.length < 2) continue
      c.forEach((m) => inExact.add(m))
      const list = items(l, c)
      groups.push({ key: `x:${row.full_hash}:${c[0]}`, kind: 'exact', items: list, suggestedKeep: suggestKeep(list) })
    }
  }

  let scanned = l.db.value<number>('SELECT count(*) FROM media WHERE deleted_at IS NULL') ?? 0
  if (opts.similar) {
    const rows = l.db.all<{ id: number; phash: string; w: number | null; h: number | null; kind: number; dur: number | null }>(
      'SELECT id, phash, width AS w, height AS h, kind, duration AS dur FROM media WHERE deleted_at IS NULL AND phash IS NOT NULL'
    )
    scanned = rows.length
    const hi = new Uint32Array(rows.length)
    const lo = new Uint32Array(rows.length)
    rows.forEach((r, i) => {
      hi[i] = parseInt(r.phash.slice(0, 8), 16) >>> 0
      lo[i] = parseInt(r.phash.slice(8, 16), 16) >>> 0
    })
    const threshold = Math.max(0, Math.min(16, opts.threshold))
    // Pigeonhole: two hashes within distance d share at least one of (d+1) exact chunks.
    const chunks = Math.min(8, threshold + 1)
    const bitsPer = Math.floor(64 / chunks)
    const chunkOf = (i: number, c: number): number => {
      const start = c * bitsPer
      const len = c === chunks - 1 ? 64 - start : bitsPer
      const big = (BigInt(hi[i]) << 32n) | BigInt(lo[i])
      return Number((big >> BigInt(64 - start - len)) & ((1n << BigInt(len)) - 1n))
    }
    const uf = new UnionFind()
    const linked = new Set<number>()
    for (let c = 0; c < chunks; c++) {
      const buckets = new Map<number, number[]>()
      for (let i = 0; i < rows.length; i++) {
        const k = chunkOf(i, c)
        const b = buckets.get(k)
        if (b) b.push(i)
        else buckets.set(k, [i])
      }
      for (const b of buckets.values()) {
        if (b.length < 2 || b.length > 400) continue // huge buckets are flat/blank images
        for (let x = 0; x < b.length; x++) {
          for (let y = x + 1; y < b.length; y++) {
            const i = b[x], j = b[y]
            const ri = rows[i], rj = rows[j]
            if (ri.kind !== rj.kind) continue
            // Videos are only "look-alikes" if they're also about the same length.
            if (ri.kind === 2 && (!ri.dur || !rj.dur || Math.abs(ri.dur - rj.dur) > Math.max(1, 0.02 * Math.max(ri.dur, rj.dur)))) continue
            if (inExact.has(ri.id) && inExact.has(rj.id)) continue
            const d = popcount32(hi[i] ^ hi[j]) + popcount32(lo[i] ^ lo[j])
            if (d > threshold) continue
            if (ri.w && ri.h && rj.w && rj.h) {
              const ar = ri.w / ri.h, br = rj.w / rj.h
              if (Math.abs(ar - br) / Math.max(ar, br) > 0.06) continue
            }
            if (ignored.has(pairKey(ri.id, rj.id))) continue
            uf.union(ri.id, rj.id)
            linked.add(ri.id)
            linked.add(rj.id)
          }
        }
      }
    }
    const clusters = new Map<number, number[]>()
    for (const id of linked) {
      const r = uf.find(id)
      clusters.set(r, [...(clusters.get(r) ?? []), id])
    }
    for (const c of clusters.values()) {
      if (c.length < 2 || c.length > 50) continue
      const list = items(l, c)
      groups.push({ key: `s:${Math.min(...c)}`, kind: 'similar', items: list, suggestedKeep: suggestKeep(list) })
    }
  }
  groups.sort((a, b) => (a.kind === b.kind ? b.items.length - a.items.length : a.kind === 'exact' ? -1 : 1))
  return { groups, scanned, durationMs: Date.now() - t0 }
}

export function ignoreGroup(ids: number[]): void {
  const l = lib()
  l.db.tx(() => {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = Math.min(ids[i], ids[j]), b = Math.max(ids[i], ids[j])
        l.db.run('INSERT OR IGNORE INTO duplicate_ignores(a, b) VALUES (?, ?)', a, b)
      }
  })
}

export function duplicatesOf(id: number): number[] {
  const l = lib()
  const r = l.db.get<{ size: number; quick_hash: string | null }>('SELECT size, quick_hash FROM media WHERE id = ?', id)
  if (!r?.quick_hash) return []
  return l.db
    .all<{ id: number }>('SELECT id FROM media WHERE size = ? AND quick_hash = ? AND id != ? AND deleted_at IS NULL', r.size, r.quick_hash, id)
    .map((x) => x.id)
}

