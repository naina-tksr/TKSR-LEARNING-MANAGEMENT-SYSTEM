import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from './helpers.js'

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'server/migrations')

/**
 * Applies pending `.sql` migration files in filename order. Applied files are
 * recorded in `_migrations` and never run twice. Each file runs in its own
 * transaction so a failure never leaves a partially applied migration.
 */
export function runMigrations(db: DatabaseSync = getDb(), dir: string = MIGRATIONS_DIR): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
  )

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  )

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const appliedNow: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
      db.exec('COMMIT')
      appliedNow.push(file)
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // already aborted
      }
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }
  return appliedNow
}
