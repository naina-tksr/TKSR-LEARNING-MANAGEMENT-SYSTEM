export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TutorContext {
  userName: string
  role: string
  programs: string[]
  currentProgram?: string
}

export interface TutorRequest {
  messages: ChatMessage[]
  context: TutorContext
}

export interface EvaluationRequest {
  assignmentTitle: string
  assignmentDescription: string
  maxMarks: number
  rubric: { criteria: string; maxMarks: number }[]
  submissionText: string
  submissionUrl: string | null
  fileName: string | null
  isLate: boolean
}

export interface EvaluationSuggestion {
  suggestedScore: number
  strengths: string[]
  weaknesses: string[]
  feedback: string
}

/**
 * Provider abstraction for AI features. Implementations must never expose
 * API keys to the client — they are only used server-side.
 */
export interface AIProvider {
  readonly name: string
  /** Conversational learning tutor: explanations and hints, never full answers to graded work. */
  tutorChat(request: TutorRequest): Promise<string>
  /** One-off evaluation suggestion for a submission. Never releases a grade by itself. */
  evaluate(request: EvaluationRequest): Promise<EvaluationSuggestion>
}

export function buildTutorSystemPrompt(context: TutorContext): string {
  const programs =
    context.programs.length > 0
      ? context.programs.map((title) => `- ${title}`).join('\n')
      : '- (no enrolled programs yet)'
  return `You are the TKSR Learning Tutor, the built-in AI learning assistant of the TKSR Learning LMS.

Learner: ${context.userName} (${context.role})
${context.currentProgram ? `Currently viewing: ${context.currentProgram}` : ''}

Programs available to this learner:
${programs}

How to behave:
- Explain concepts step by step, give hints, worked examples and guided practice questions.
- Give one clear explanation at a time; keep responses under ~250 words, using short paragraphs or bullet points.
- Encourage the learner: end with a follow-up question or a small practice task when it helps.
- If you are unsure, say so honestly and point to what the learner should review.

Hard rules:
- NEVER write or complete a graded assignment, essay, report, submission or final answer for the learner.
- If asked to do their assignment, refuse politely and instead offer: (1) a hint, (2) an outline, (3) a similar practice example they can learn from.
- Do not invent course grades, deadlines or admin decisions.`
}

export function buildEvaluationSystemPrompt(): string {
  return `You are the AI Assignment Evaluation Assistant inside the TKSR Learning LMS.
You help a trainer by suggesting a score, strengths, weaknesses and feedback for one student submission.

Rules:
- Judge only what is in the submission against the assignment description and rubric.
- Be fair, specific and constructive; quote short evidence from the submission where useful.
- Never invent facts that are not in the submission.
- The trainer reviews and edits your suggestion; the grade is never published automatically.

Respond with a single JSON object and nothing else:
{
  "suggestedScore": <integer 0..maxMarks>,
  "strengths": [<2-4 short bullet strings>],
  "weaknesses": [<2-4 short bullet strings>],
  "feedback": "<2-5 sentence overall feedback addressed to the student>"
}`
}

export function buildEvaluationUserPrompt(request: EvaluationRequest): string {
  const rubric =
    request.rubric.length > 0
      ? request.rubric.map((item) => `- ${item.criteria} (${item.maxMarks} marks)`).join('\n')
      : '(no rubric criteria defined)'
  const attachments = [
    request.submissionUrl ? `Link: ${request.submissionUrl}` : null,
    request.fileName ? `File: ${request.fileName}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  return `Assignment: ${request.assignmentTitle}
Max marks: ${request.maxMarks}
Due date passed: ${request.isLate ? 'yes (submitted late)' : 'no'}

Description:
${request.assignmentDescription || '(none)'}

Rubric:
${rubric}

Student submission (text):
${request.submissionText || '(no text answer provided)'}
${attachments ? `\nAttachments:\n${attachments}` : ''}`
}
