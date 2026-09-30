// Thin wrapper over node:sqlite (bundled with Electron's Node runtime, so no
// native module has to be rebuilt per platform). Adds a statement cache,
// nested transactions via savepoints, and schema migrations.

import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite'
import { MIGRATIONS } from './schema'

export type Param = SQLInputValue
export type Row = Record<string, unknown>

export class Database {
  readonly raw: DatabaseSync
  private cache = new Map<string, StatementSync>()
  private depth = 0

  constructor(readonly file: string) {
    this.raw = new DatabaseSync(file)
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -65536;
      PRAGMA mmap_size = 268435456;
      PRAGMA busy_timeout = 5000;
    `)
    this.migrate()
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params)
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  /** Scalar helper: first column of first row. */
  value<T = number>(sql: string, ...params: Param[]): T | undefined {
    const row = this.stmt(sql).get(...params) as Row | undefined
    if (!row) return undefined
    const k = Object.keys(row)[0]
    return row[k] as T
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  tx<T>(fn: () => T): T {
    const depth = this.depth++
    const sp = `sp${depth}`
    this.raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
    try {
      const result = fn()
      this.raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
      return result
    } catch (err) {
      try {
        this.raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      } catch {
        /* already rolled back */
      }
      throw err
    } finally {
      this.depth--
    }
  }

  private migrate(): void {
    const current = (this.value<number>('PRAGMA user_version') ?? 0) as number
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v])
        this.raw.exec(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  checkpoint(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
  }

  close(): void {
    this.cache.clear()
    try {
      this.raw.exec('PRAGMA optimize')
    } catch {
      /* ignore */
    }
    this.raw.close()
  }
}

/** JSON array helper for `IN (SELECT value FROM json_each(?))` queries. */
export const ids = (list: readonly number[]): string => JSON.stringify(list)
