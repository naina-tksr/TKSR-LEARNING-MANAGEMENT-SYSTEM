import {
  buildEvaluationSystemPrompt,
  buildEvaluationUserPrompt,
  buildTutorSystemPrompt,
  type AIProvider,
  type EvaluationRequest,
  type EvaluationSuggestion,
  type TutorRequest,
} from './types.js'

interface OpenAISettings {
  apiKey: string
  baseUrl: string
  model: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
}

/** Talks to any OpenAI-compatible `/chat/completions` endpoint over HTTPS. */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai'

  constructor(private settings: OpenAISettings) {}

  private async complete(messages: { role: string; content: string }[], jsonMode: boolean): Promise<string> {
    const response = await fetch(`${this.settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        temperature: 0.3,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`AI request failed with status ${response.status}: ${body.slice(0, 200)}`)
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (!content || content.trim().length === 0) throw new Error('AI returned an empty response')
    return content
  }

  async tutorChat(request: TutorRequest): Promise<string> {
    return this.complete(
      [
        { role: 'system', content: buildTutorSystemPrompt(request.context) },
        ...request.messages.map((message) => ({ role: message.role, content: message.content })),
      ],
      false,
    )
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationSuggestion> {
    const raw = await this.complete(
      [
        { role: 'system', content: buildEvaluationSystemPrompt() },
        { role: 'user', content: buildEvaluationUserPrompt(request) },
      ],
      true,
    )
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<
      string,
      unknown
    >
    const score = Number(parsed.suggestedScore)
    return {
      suggestedScore: Number.isFinite(score)
        ? Math.round(clamp(score, 0, request.maxMarks))
        : 0,
      strengths: toStringArray(parsed.strengths),
      weaknesses: toStringArray(parsed.weaknesses),
      feedback: String(parsed.feedback ?? '').trim(),
    }
  }
}
