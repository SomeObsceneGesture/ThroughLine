// worker_threads pool with priority lanes so interactive work (viewer previews)
// jumps ahead of import probing, which jumps ahead of background thumbnailing.

import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'

export const LANE_INTERACTIVE = 0
export const LANE_IMPORT = 1
export const LANE_BACKGROUND = 2
type Lane = 0 | 1 | 2

interface Task {
  id: number
  type: string
  payload: unknown
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  cancelled?: boolean
}

interface Slot {
  worker: Worker
  inFlight: Map<number, Task>
  alive: boolean
}

export class TaskError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
  }
}

const PER_WORKER = 2

export class WorkerPool {
  private slots: Slot[] = []
  private lanes: Task[][] = [[], [], []]
  private nextId = 1
  private destroyed = false

  constructor(private script: string, private workerData: unknown, size: number) {
    this.resize(size)
  }

  static defaultSize(): number {
    return Math.max(2, Math.min(6, cpus().length - 1))
  }

  get size(): number {
    return this.slots.length
  }

  resize(size: number): void {
    size = Math.max(1, Math.min(16, size))
    while (this.slots.length < size) this.slots.push(this.spawn())
    while (this.slots.length > size) {
      const slot = this.slots.pop()!
      slot.alive = false
      // Let in-flight work finish, then terminate.
      const check = (): void => {
        if (slot.inFlight.size === 0) void slot.worker.terminate()
        else setTimeout(check, 200)
      }
      check()
    }
    this.pump()
  }

  private spawn(): Slot {
    const worker = new Worker(this.script, { workerData: this.workerData })
    const slot: Slot = { worker, inFlight: new Map(), alive: true }
    worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string; detail?: string }) => {
      const task = slot.inFlight.get(msg.id)
      if (!task) return
      slot.inFlight.delete(msg.id)
      if (msg.ok) task.resolve(msg.result)
      else task.reject(new TaskError(msg.error ?? 'Task failed', msg.detail))
      this.pump()
    })
    const fail = (err: Error): void => {
      for (const task of slot.inFlight.values()) task.reject(new TaskError('The file could not be processed (worker crashed)', err.message))
      slot.inFlight.clear()
      const idx = this.slots.indexOf(slot)
      if (idx >= 0 && !this.destroyed) {
        this.slots[idx] = this.spawn()
        this.pump()
      }
    }
    worker.on('error', fail)
    worker.on('exit', (code) => {
      if (slot.alive && !this.destroyed && code !== 0) fail(new Error(`worker exited with code ${code}`))
    })
    return slot
  }

  run<T>(type: string, payload: unknown, lane: Lane = LANE_BACKGROUND): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('Pool destroyed'))
    return new Promise<T>((resolve, reject) => {
      this.lanes[lane].push({ id: this.nextId++, type, payload, resolve: resolve as (v: unknown) => void, reject })
      this.pump()
    })
  }

  /** Number of queued (not yet started) tasks in a lane. */
  queued(lane: Lane): number {
    return this.lanes[lane].length
  }

  busy(): number {
    return this.slots.reduce((n, s) => n + s.inFlight.size, 0)
  }

  capacity(): number {
    return this.slots.length * PER_WORKER
  }

  private nextTask(): Task | undefined {
    for (const lane of this.lanes) {
      while (lane.length) {
        const t = lane.shift()!
        if (!t.cancelled) return t
      }
    }
    return undefined
  }

  private pump(): void {
    if (this.destroyed) return
    for (;;) {
      const slot = this.slots
        .filter((s) => s.alive && s.inFlight.size < PER_WORKER)
        .sort((a, b) => a.inFlight.size - b.inFlight.size)[0]
      if (!slot) return
      const task = this.nextTask()
      if (!task) return
      slot.inFlight.set(task.id, task)
      slot.worker.postMessage({ id: task.id, type: task.type, payload: task.payload })
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    for (const lane of this.lanes) for (const t of lane) t.reject(new Error('Pool destroyed'))
    this.lanes = [[], [], []]
    await Promise.all(this.slots.map((s) => s.worker.terminate()))
    this.slots = []
  }
}
