import { config } from '../config.js'
import { closeDatabase, initDatabase } from './helpers.js'
import { runMigrations } from './migrate.js'

// CLI entry point: `npm run db:migrate`
initDatabase(config.databasePath)
const applied = runMigrations()
if (applied.length === 0) {
  console.log(`Database is up to date: ${config.databasePath}`)
} else {
  console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`)
  console.log(`Database ready: ${config.databasePath}`)
}
closeDatabase()
