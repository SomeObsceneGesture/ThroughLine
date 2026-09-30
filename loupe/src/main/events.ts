// Main → renderer event broadcasting.

import { BrowserWindow } from 'electron'
import type { Events } from '@shared/api'

export function emit<E extends keyof Events>(event: E, payload: Events[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}

/** Coalesces rapid-fire item change notifications into one event per interval. */
export class ChangeBatcher {
  private ids = new Set<number>()
  private structural = false
  private timer: NodeJS.Timeout | null = null

  constructor(private interval = 120) {}

  items(list: Iterable<number>): void {
    for (const id of list) this.ids.add(id)
    this.schedule()
  }

  structure(): void {
    this.structural = true
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.interval)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.structural) {
      emit('library:changed', { type: 'structure' })
      this.structural = false
    }
    if (this.ids.size) {
      emit('library:changed', { type: 'items', ids: [...this.ids] })
      this.ids.clear()
    }
  }
}
