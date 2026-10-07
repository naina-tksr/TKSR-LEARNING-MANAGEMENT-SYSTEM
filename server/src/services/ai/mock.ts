import type { AIProvider, EvaluationRequest, EvaluationSuggestion, TutorRequest } from './types.js'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length
}

const ASSIGNMENT_REQUEST =
  /\b(write|complete|do|solve|answer|finish|submit)\b[^.?!]{0,60}\b(assignment|essay|report|homework|submission|project|answer sheet)\b|\bwrite my\b|\bdone for me\b|\bdo it for me\b/i

interface TopicEntry {
  keywords: string[]
  answer: string
}

const TOPICS: TopicEntry[] = [
  {
    keywords: ['precision', 'recall', 'f1'],
    answer: `**Precision vs recall** answer different questions:

- *Precision* — of everything the model flagged positive, how much was right? (Minimises false alarms.)
- *Recall* — of everything that truly was positive, how much did it find? (Minimises misses.)
- *F1* is the harmonic mean of both, useful when classes are imbalanced.

**Hint:** pick your metric from the cost of errors. Fraud detection? Favour recall (missed fraud is expensive). Email spam filtering? Favour precision (false positives annoy users).

**Try this:** for a classifier with 80 true positives, 20 false positives and 30 false negatives, compute precision and recall — which error type dominates?`,
  },
  {
    keywords: ['overfit', 'overfitting', 'underfit', 'generalis', 'generaliz'],
    answer: `**Overfitting** happens when a model memorises training data — including its noise — instead of learning the underlying pattern. You'll see training accuracy climb while validation accuracy stalls or drops.

Common fixes:
- Get more training data (the best regulariser)
- Simplify the model (fewer parameters)
- Regularisation (L1/L2, dropout)
- Early stopping on a validation set

**Hint:** the *gap* between training and validation performance is your diagnostic — small gap = underfitting, big gap = overfitting.

**Try this:** take a model at 99% train / 72% validation accuracy — which three changes would you try first, in order?`,
  },
  {
    keywords: ['gradient descent', 'learning rate', 'loss function', 'optimis', 'optimiz'],
    answer: `**Gradient descent** works by repeatedly nudging weights in the direction that most reduces the loss:

1. Forward pass → compute prediction and loss.
2. Backward pass → gradient tells you each weight's influence on the error.
3. Update: \`weights -= learningRate × gradient\`.

The learning rate is the knob that matters most:
- Too high → the loss oscillates or diverges.
- Too low → painfully slow convergence.
- Just right → steady decrease.

**Hint:** watch the loss curve. If it zigzags, lower the rate; if it crawls, raise it.

**Try this:** why is the squared-error loss commonly used for regression but cross-entropy for classification?`,
  },
  {
    keywords: ['neural network', 'backprop', 'activation', 'hidden layer'],
    answer: `A **neural network** learns by stacking simple units:

- Each neuron computes a weighted sum + bias, then passes it through a non-linear *activation* (ReLU, sigmoid).
- **Backpropagation** propagates the error backwards so each weight knows how much it contributed.
- Non-linear activations are what let the network learn anything beyond a straight line.

**Hint:** think of layers as a feature hierarchy — early layers learn simple patterns, later layers combine them into concepts.

**Try this:** why would a network with only linear activations be equivalent to plain logistic regression?`,
  },
  {
    keywords: ['train', 'test', 'validation', 'split', 'cross-validation', 'cross validation'],
    answer: `Why we split data three ways:

- **Training set (~70%)** — the model learns from this.
- **Validation set (~15%)** — used to tune hyperparameters and make design decisions.
- **Test set (~15%)** — touched *once*, at the very end, for an unbiased estimate.

If you tune against the test set, it quietly becomes a second validation set and your final number is optimistic.

**Hint:** split *before* any preprocessing that learns from data (scaling, imputation) to avoid leakage.

**Try this:** for 10,000 rows with 3% positive class, how would you split so the test set still has enough positives?`,
  },
  {
    keywords: ['regression', 'classification', 'binary', 'logistic'],
    answer: `**Regression vs classification** — the target decides:

- *Regression* → continuous number (house price, demand forecast). Metrics: MAE, RMSE, R².
- *Classification* → discrete labels (spam/not spam). Metrics: accuracy, precision/recall, AUC.

Related trick: logistic regression predicts a *probability* for classes despite its name.

**Hint:** a quick test — if averaging your targets makes no sense, it's probably classification.

**Try this:** customer churn "in the next 30 days" — regression or classification? What if you wanted expected churn days?`,
  },
  {
    keywords: ['transformer', 'attention', 'llm', 'large language model', 'token'],
    answer: `The **transformer** architecture rests on *self-attention*:

- Every token looks at every other token and learns which ones matter most for its representation (query × key → weights × values).
- That lets the model capture long-range dependencies without recurrence.
- Multi-head attention = several attention patterns in parallel; positional encoding restores word order.

**Hint:** attention weights are why you can put a clause 50 words away and still have it influence the next token.

**Try this:** why is transformer training parallelisable while an RNN's is not?`,
  },
  {
    keywords: ['pandas', 'python', 'dataframe', 'numpy', 'cleaning'],
    answer: `Working with tabular data in **Python** — the core loop:

1. Load: \`pd.read_csv(...)\`
2. Inspect: \`.shape\`, \`.info()\`, \`.describe()\`, \`.isna().sum()\`
3. Clean: handle missing values, fix dtypes, remove duplicates.
4. Engineer: groupby aggregations, one-hot encoding, scaling.
5. Split → train.

**Hint:** always check for duplicates and target leakage *before* modelling — most "amazing" results come from leakage.

**Try this:** from a sales CSV, how would you build a "average monthly spend per customer" feature in one or two lines of pandas?`,
  },
  {
    keywords: ['deploy', 'deployment', 'serving', 'inference', 'api', 'production'],
    answer: `Putting a model into **production** — what changes:

- Package the model + preprocessing as a versioned artefact.
- Expose it behind a small API with input validation and timeouts.
- Log inputs/outputs so you can monitor drift.
- Set a retraining trigger when metrics decay.

**Hint:** the model is usually 20% of the work; data pipelines, monitoring and rollback plans are the rest.

**Try this:** your model's accuracy dropped 8 points this week — what are the first three things you would check?`,
  },
  {
    keywords: ['feature', 'engineering', 'scaling', 'normalis', 'normaliz', 'standard'],
    answer: `**Feature engineering** turns raw data into signal a model can use:

- Numerical: scaling (min-max, standardisation), log transforms for skewed data, binning.
- Categorical: one-hot for low cardinality, target/frequency encoding for high cardinality.
- Text: token counts, TF-IDF, embeddings.
- Dates: day of week, recency, cyclic encoding.

**Hint:** fit transformers *on the training set only*, then apply the same transform to validation/test — otherwise you leak information.

**Try this:** income is heavily right-skewed — which transformation would you try first, and why?`,
  },
]

const GENERIC_TEMPLATE = `Great question. Let's break it down:

1. **Restate the concept** — put the idea in your own words first; if you can't explain it simply, that's the gap to close.
2. **Connect it to what you know** — relate it to an earlier lesson in your program and to a concrete example.
3. **Check your understanding** — try a small worked example, then vary one thing and predict what changes.

**Hint:** search your course notes for this term and compare the definition with how it was used in the lesson example.

**Try this:** explain the concept back in 2–3 sentences, then give one example and one counter-example.`

function findTopic(message: string): TopicEntry | null {
  const lower = message.toLowerCase()
  return TOPICS.find((topic) => topic.keywords.some((keyword) => lower.includes(keyword))) ?? null
}

const REFUSAL = `I can't complete a graded assignment for you — that would work against your own learning (and your trainer would notice!).

But I can help you get unstuck:

- **Outline first:** list the 3–5 points your answer must cover, in order.
- **Start small:** answer just the first sub-question, and I'll give you feedback on your reasoning.
- **Practice example:** I can walk through a *similar* problem you can learn from, then you apply it to yours.

Tell me which part you've attempted so far, or which rubric criterion feels unclear, and we'll work through it together.`

/**
 * Deterministic offline provider used when no API key is configured
 * (`AI_PROVIDER=mock` or `AI_PROVIDER=auto` without `OPENAI_API_KEY`).
 * Keeps every AI feature demoable without network access.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock'

  async tutorChat(request: TutorRequest): Promise<string> {
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')
    const message = lastUserMessage?.content ?? ''
    if (ASSIGNMENT_REQUEST.test(message)) return REFUSAL
    const topic = findTopic(message)
    const programLine =
      request.context.currentProgram ?? request.context.programs[0] ?? 'your program'
    const prefix = `Good question — this comes up a lot in *${programLine}*.\n\n`
    return prefix + (topic ? topic.answer : GENERIC_TEMPLATE)
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationSuggestion> {
    const text = request.submissionText.trim()
    const words = countWords(text)
    const maxMarks = request.maxMarks

    const rubric = request.rubric.length > 0
      ? request.rubric
      : [{ criteria: 'Overall effort and correctness', maxMarks }]

    const lower = text.toLowerCase()
    const covered = rubric.filter((item) => {
      const terms = item.criteria
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 4)
      return terms.some((term) => lower.includes(term))
    })
    const coverageRatio = covered.length / rubric.length

    const hasAttachment = Boolean(request.submissionUrl || request.fileName)
    const structureBonus = /\n\s*[-*•]|\n\s*\d[.)]/.test(text) ? 0.1 : 0
    const depthRatio = clamp(words / 180, 0, 1)

    let ratio = depthRatio * 0.45 + coverageRatio * 0.35 + structureBonus
    if (hasAttachment) ratio += 0.1
    if (words < 25) ratio = Math.min(ratio, 0.25)
    else if (words < 60) ratio = Math.min(ratio, 0.55)
    if (request.isLate) ratio -= 0.05

    const suggestedScore = clamp(Math.round(maxMarks * clamp(ratio, 0.05, 1)), 0, maxMarks)

    const strengths: string[] = []
    if (words >= 60) strengths.push('The submission is substantial enough to engage with the question seriously.')
    else if (words > 0) strengths.push('A concise start that gets to the point quickly.')
    if (structureBonus > 0) strengths.push('Structured with lists or steps, which makes the argument easy to follow.')
    for (const item of covered.slice(0, 2)) {
      strengths.push(`Addresses the rubric criterion "${item.criteria}" with explicit content.`)
    }
    if (hasAttachment) strengths.push('Supports the written answer with an attached resource or link.')
    while (strengths.length < 2) {
      strengths.push('Shows a genuine attempt at the core idea of the assignment.')
    }

    const weaknesses: string[] = []
    const uncovered = rubric.filter((item) => !covered.includes(item))
    for (const item of uncovered.slice(0, 2)) {
      weaknesses.push(`The rubric criterion "${item.criteria}" is barely covered — add a dedicated section for it.`)
    }
    if (words < 100) weaknesses.push('Too short to demonstrate reasoning — walk through each step, not just conclusions.')
    if (!structureBonus) weaknesses.push('A wall of text: use headings or numbered steps so the reader can follow the flow.')
    if (words >= 100 && coverageRatio >= 0.5) {
      weaknesses.push('Claims are stated without evidence — quote data, code or sources to back them up.')
    }
    if (request.isLate) weaknesses.push('Submitted after the due date; confirm an extension with your trainer.')
    while (weaknesses.length < 2) {
      weaknesses.push('Could go deeper: add one worked example to prove the reasoning, not just assert it.')
    }

    const feedback =
      `This submission scored around ${suggestedScore}/${maxMarks}. ` +
      `It ${strengths[0].charAt(0).toLowerCase()}${strengths[0].slice(1)} ` +
      `Main gap: ${weaknesses[0].charAt(0).toLowerCase()}${weaknesses[0].slice(1)} ` +
      `Revise the weak areas and resubmit if your trainer allows re-attempts.`

    return { suggestedScore, strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 4), feedback }
  }
}
