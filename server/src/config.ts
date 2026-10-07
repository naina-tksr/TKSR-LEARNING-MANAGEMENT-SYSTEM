import path from 'node:path'
import dotenv from 'dotenv'

// Loads `.env` from the project root when present (no-op otherwise).
dotenv.config()

const cwd = process.cwd()

function resolvePath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return path.resolve(cwd, trimmed && trimmed.length > 0 ? trimmed : fallback)
}

export type AIProviderName = 'auto' | 'openai' | 'mock'

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 5175),
  databasePath: resolvePath(process.env.DATABASE_PATH, 'server/data/tksr.sqlite'),
  uploadDir: resolvePath(process.env.UPLOAD_DIR, 'server/uploads'),
  clientDist: resolvePath(process.env.CLIENT_DIST, 'dist'),
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxUploadBytes: Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 5)) * 1024 * 1024,
  ai: {
    provider: (process.env.AI_PROVIDER ?? 'auto') as AIProviderName,
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
}

// Development fallback so `npm run dev` works without a .env file. Production
// refuses to boot with a missing/weak secret.
export const DEV_JWT_SECRET = 'tksr-learning-dev-secret-do-not-use-in-production'

export function getJwtSecret(): string {
  const secret = config.jwtSecret.trim()
  if (secret.length > 0) return secret
  if (config.isProd) {
    throw new Error('JWT_SECRET must be set in production')
  }
  return DEV_JWT_SECRET
}
