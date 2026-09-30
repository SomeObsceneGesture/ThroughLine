// Paths handed to the app by the OS: command-line arguments ("Open With",
// file associations, dropping onto the app icon on Windows/Linux), macOS
// open-file events, and second-instance launches.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { emit } from './events'

let pending: string[] = []
let rendererReady = false

export function pathsFromArgv(argv: string[], cwd = process.cwd()): string[] {
  return argv
    .filter((a) => a && !a.startsWith('-') && !/electron(\.exe)?$/i.test(a) && !a.endsWith('.js') && a !== '.')
    .map((a) => resolve(cwd, a))
    .filter((p) => {
      try {
        return existsSync(p)
      } catch {
        return false
      }
    })
    .filter((p) => !/[\\/](app\.asar|resources)([\\/]|$)/i.test(p) && !/loupe(\.exe)?$/i.test(p))
}

export function queueLaunchPaths(paths: string[]): void {
  if (!paths.length) return
  if (rendererReady) emit('open-paths', paths)
  else pending.push(...paths)
}

export function consumeLaunchPaths(): string[] {
  rendererReady = true
  const out = pending
  pending = []
  return out
}

export function resetRendererReady(): void {
  rendererReady = false
}
