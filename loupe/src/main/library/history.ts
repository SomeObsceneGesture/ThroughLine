// Undo / redo for organisational and file operations. Each entry carries its
// own inverse; permanent deletions are confirmed up front and never recorded.

import { emit } from '../events'
import type { HistoryState } from '@shared/types'

export interface HistoryEntry {
  label: string
  undo(): void | Promise<void>
  redo(): void | Promise<void>
}

const LIMIT = 200

class History {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private busy = false

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.broadcast(entry.label, 'do')
  }

  async undo(): Promise<string | null> {
    if (this.busy) return null
    const entry = this.undoStack.pop()
    if (!entry) return null
    this.busy = true
    try {
      await entry.undo()
      this.redoStack.push(entry)
    } finally {
      this.busy = false
    }
    this.broadcast(entry.label, 'undo')
    return entry.label
  }

  async redo(): Promise<string | null> {
    if (this.busy) return null
    const entry = this.redoStack.pop()
    if (!entry) return null
    this.busy = true
    try {
      await entry.redo()
      this.undoStack.push(entry)
    } finally {
      this.busy = false
    }
    this.broadcast(entry.label, 'redo')
    return entry.label
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.broadcast()
  }

  state(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null
    }
  }

  private broadcast(action?: string, kind?: 'do' | 'undo' | 'redo'): void {
    emit('history', { ...this.state(), action, kind })
  }
}

export const history = new History()
