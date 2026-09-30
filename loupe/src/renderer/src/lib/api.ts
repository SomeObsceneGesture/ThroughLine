// Typed access to the main process.

import type { Api, ApiArgs, ApiMethod, Events } from '@shared/api'

export function call<K extends ApiMethod>(method: K, ...args: ApiArgs<K>): Promise<Awaited<ReturnType<Api[K]>>> {
  return window.loupe.invoke(method, ...args)
}

export function on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): () => void {
  return window.loupe.on(event, cb)
}

export const platform = window.loupe?.platform ?? 'linux'
export const isMac = platform === 'darwin'
export const mod = isMac ? '⌘' : 'Ctrl'

export function pathForFile(f: File): string {
  try {
    return window.loupe.pathForFile(f)
  } catch {
    return ''
  }
}

export const thumbUrl = (id: number, version = 0): string => `loupe://thumb/${id}?v=${version}`
