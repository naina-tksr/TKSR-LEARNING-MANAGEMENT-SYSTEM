import fs from 'node:fs'
import { createApp } from './app.js'
import { config, getJwtSecret } from './config.js'
import { closeDatabase, initDatabase } from './db/helpers.js'
import { runMigrations } from './db/migrate.js'
import { getAIProvider } from './services/ai/index.js'




async function main(): Promise<void> {
  initDatabase(config.databasePath)
  const applied = runMigrations()
  if (applied.length > 0) {
    console.log(`[db] Applied ${applied.length} migration(s): ${applied.join(', ')}`)
  }
   try {
    const { get } = await import("./db/helpers.js");
    const row: any =get("SELECT COUNT(*) as c FROM users")
    if (!row || row.c ===0) {
      console.log("[db] Empty database, seeding ...")
      // await import("./db/seed.js");
      console.log("[db] Seeding complete.")
      const mod: any = await import("./db/seed.js");
      if(mod.seed){
         await mod.seed();
         const {initDatabase :reInit} = await import("./db/helpers.js");
         reInit(config.databasePath)
      }
      console.log("[db] Seeding complete.")
    }
   }catch(e){
    console.log("[db] seeding check error", e)
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
