import fs from 'node:fs'
import { createApp } from './app.js'
import { config, getJwtSecret } from './config.js'
import { closeDatabase, initDatabase } from './db/helpers.js'
import { runMigrations } from './db/migrate.js'
import { getAIProvider } from './services/ai/index.js'

function main(): void {
  initDatabase(config.databasePath)
  const applied = runMigrations()
  if (applied.length > 0) {
    console.log(`[db] Applied ${applied.length} migration(s): ${applied.join(', ')}`)
  }
  fs.mkdirSync(config.uploadDir, { recursive: true })

  try {
    getJwtSecret()
  } catch (error) {
    console.error(`[auth] ${(error as Error).message}`)
    process.exit(1)
  }
  if (!config.isProd && !config.jwtSecret) {
    console.warn('[auth] JWT_SECRET not set — using the development-only secret. Set it in .env.')
  }

  let aiLabel: string
  try {
    aiLabel = getAIProvider().name
  } catch (error) {
    aiLabel = 'unavailable'
    console.warn(`[ai] ${(error as Error).message}`)
  }

  const app = createApp()
  const server = app.listen(config.port, () => {
    console.log(`TKSR Learning API listening on http://localhost:${config.port}`)
    console.log(`[db]   ${config.databasePath}`)
    console.log(`[ai]   provider: ${aiLabel}`)
    console.log(`[env]  ${config.env}`)
  })

  const shutdown = (): void => {
    console.log('\nShutting down...')
    server.close(() => {
      closeDatabase()
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
