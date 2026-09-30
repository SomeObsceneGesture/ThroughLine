// Process-wide state for the open library and its background services.

import type { Library } from './library/library'
import type { WorkerPool } from './workers/pool'
import type { Indexer } from './import/indexer'
import type { Importer } from './import/importer'
import { ChangeBatcher } from './events'

export interface Context {
  library: Library | null
  pool: WorkerPool | null
  indexer: Indexer | null
  importer: Importer | null
  changes: ChangeBatcher
  ffmpegPath: string | null
  ffprobePath: string | null
  workerScript: string
}

export const ctx: Context = {
  library: null,
  pool: null,
  indexer: null,
  importer: null,
  changes: new ChangeBatcher(150),
  ffmpegPath: null,
  ffprobePath: null,
  workerScript: ''
}

export function lib(): Library {
  if (!ctx.library) throw new Error('No library is open')
  return ctx.library
}

export function pool(): WorkerPool {
  if (!ctx.pool) throw new Error('Background workers are not running')
  return ctx.pool
}
