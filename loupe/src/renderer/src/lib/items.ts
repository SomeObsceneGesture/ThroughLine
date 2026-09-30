// Lazily fetched item details, keyed by id. Visible cells request what they
// need; requests are batched per animation frame. An LRU bound keeps memory
// flat no matter how large the library is.

import { create } from 'zustand'
import type { MediaItem } from '@shared/types'
import { call } from './api'

const MAX = 6000
const cache = new Map<number, MediaItem>()
const pending = new Set<number>()
const inFlight = new Set<number>()
/** Cached entries known to be out of date (still shown until refreshed). */
const stale = new Set<number>()
let scheduled = false

export const useItemsVersion = create<{ v: number }>(() => ({ v: 0 }))
const bump = (): void => useItemsVersion.setState((s) => ({ v: s.v + 1 }))

export function getItem(id: number): MediaItem | undefined {
  const it = cache.get(id)
  if (it) {
    // refresh LRU position
    cache.delete(id)
    cache.set(id, it)
  }
  return it
}

export function peekItem(id: number): MediaItem | undefined {
  return cache.get(id)
}

function flush(): void {
  scheduled = false
  if (!pending.size) return
  const ids = [...pending].slice(0, 400)
  for (const id of ids) {
    pending.delete(id)
    inFlight.add(id)
  }
  call('media.items', ids)
    .then((items) => {
      for (const it of items) {
        cache.set(it.id, it)
        stale.delete(it.id)
      }
      while (cache.size > MAX) cache.delete(cache.keys().next().value!)
      bump()
    })
    .catch(() => undefined)
    .finally(() => {
      for (const id of ids) inFlight.delete(id)
      if (pending.size) schedule()
    })
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(flush)
}

export function requestItems(ids: Iterable<number>): void {
  let any = false
  for (const id of ids) {
    if (!cache.has(id) && !inFlight.has(id)) {
      pending.add(id)
      any = true
    }
  }
  if (any) schedule()
}

/**
 * Refresh cached entries. Cached items keep showing their current data until
 * the fresh copy arrives (no placeholder flash); uncached ids are ignored and
 * will be fetched when they scroll into view. No argument clears everything.
 */
export function invalidateItems(ids?: number[]): void {
  if (!ids) {
    cache.clear()
    stale.clear()
    bump()
    return
  }
  let any = false
  for (const id of ids) {
    if (cache.has(id)) {
      stale.add(id)
      if (!inFlight.has(id)) {
        pending.add(id)
        any = true
      }
    }
  }
  if (any) schedule()
}

export async function fetchItems(ids: number[]): Promise<MediaItem[]> {
  const missing = ids.filter((id) => !cache.has(id) || stale.has(id))
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 2000) {
      const items = await call('media.items', missing.slice(i, i + 2000))
      for (const it of items) {
        cache.set(it.id, it)
        stale.delete(it.id)
      }
    }
    bump()
  }
  return ids.map((id) => cache.get(id)).filter((x): x is MediaItem => !!x)
}
