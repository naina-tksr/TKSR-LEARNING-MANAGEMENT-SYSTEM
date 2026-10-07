import { config } from '../../config.js'
import { ApiError } from '../../middleware/error.js'
import { MockAIProvider } from './mock.js'
import { OpenAIProvider } from './openai.js'
import type { AIProvider } from './types.js'

export type { AIProvider } from './types.js'
export * from './types.js'

let provider: AIProvider | null = null

/**
 * Returns the configured AI provider. Selection is environment-driven:
 * - `AI_PROVIDER=openai` → OpenAI-compatible API (requires OPENAI_API_KEY)
 * - `AI_PROVIDER=mock`   → deterministic offline provider
 * - `AI_PROVIDER=auto`   → OpenAI when a key exists, otherwise mock
 */
export function getAIProvider(): AIProvider {
  if (provider) return provider
  const choice = config.ai.provider
  if (choice === 'openai' || (choice === 'auto' && config.ai.apiKey.length > 0)) {
    if (config.ai.apiKey.length === 0) {
      throw new ApiError(500, 'AI provider "openai" is configured but OPENAI_API_KEY is missing')
    }
    provider = new OpenAIProvider({
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
    })
  } else {
    provider = new MockAIProvider()
  }
  return provider
}

/** Test hook: force a specific provider instance. */
export function setAIProvider(next: AIProvider | null): void {
  provider = next
}
