import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { config } from '../config.js'

type SqlValue = null | number | bigint | string | Uint8Array

let database: DatabaseSync | null = null

function toBindValues(params: unknown[]): SqlValue[] {
  return params.map((param) => {
    if (param === undefined || param === null) return null
    if (typeof param === 'boolean') return param ? 1 : 0
    if (typeof param === 'number' || typeof param === 'string' || typeof param === 'bigint') return param
    if (param instanceof Uint8Array) return param
    throw new Error(`Unsupported SQL parameter type: ${typeof param}`)
  })
}

export function initDatabase(file: string = config.databasePath): DatabaseSync {
  closeDatabase()
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON;')
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;')
  }
  database = db
  return db
}

export function getDb(): DatabaseSync {
  if (!database) return initDatabase()
  return database
}

export function closeDatabase(): void {
  if (database) {
    try {
      database.close()
    } catch {
      // already closed
    }
    database = null
  }
}

function prepare(sql: string): StatementSync {
  return getDb().prepare(sql)
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return prepare(sql).all(...toBindValues(params)) as T[]
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return prepare(sql).get(...toBindValues(params)) as T | undefined
}

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export function run(sql: string, ...params: unknown[]): RunResult {
  const result = prepare(sql).run(...toBindValues(params))
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  }
}

export function exec(sql: string): void {
  getDb().exec(sql)
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export function tx<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // transaction already aborted
    }
    throw error
  }
}

export function now(): string {
  return new Date().toISOString()
}
