<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, downloadFile, formatApiError } from '../api'
import type { SubmissionDetail } from '../types'
import { formatBytes, formatDateTime, formatRelative } from '../format'
import { renderMarkdown } from '../markdown'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const submissionId = computed(() => Number(route.params.id))

const data = ref<SubmissionDetail | null>(null)
const loading = ref(true)
const error = ref<unknown>(null)

const evaluating = ref(false)
const evalError = ref('')
const grading = ref(false)
const gradeError = ref('')
const gradeNotice = ref('')

const gradeForm = reactive({ score: 0, feedback: '', evaluationId: undefined as number | undefined })

const latestEvaluation = computed(() => data.value?.evaluations[0] ?? null)
const maxMarks = computed(() => data.value?.assignment.maxMarks ?? 100)
const instructionsHtml = computed(() => renderMarkdown(data.value?.assignment.description ?? ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<SubmissionDetail>(`/submissions/${submissionId.value}`)
    const submission = data.value.submission
    const suggestion = data.value.evaluations.find((item) => item.source === 'ai')
    gradeForm.score =
      submission.status === 'graded' && submission.score !== null
        ? submission.score
        : (suggestion?.suggestedScore ?? Math.round(maxMarks.value * 0.7))
    gradeForm.feedback = submission.feedback ?? ''
    gradeForm.evaluationId = suggestion?.source === 'ai' ? suggestion.id : undefined
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

async function runEvaluation(): Promise<void> {
  evalError.value = ''
  evaluating.value = true
  try {
    const result = await api.post<{ evaluation: { id: number; suggestedScore: number } }>(
      `/submissions/${submissionId.value}/evaluate`,
    )
    gradeForm.evaluationId = result.evaluation.id
    if (data.value && data.value.submission.status !== 'graded') {
      gradeForm.score = result.evaluation.suggestedScore
    }
    await load()
    gradeForm.evaluationId = result.evaluation.id
  } catch (cause) {
    evalError.value = formatApiError(cause)
  } finally {
    evaluating.value = false
  }
}

async function releaseGrade(): Promise<void> {
  gradeError.value = ''
  gradeNotice.value = ''
  if (gradeForm.score < 0 || gradeForm.score > maxMarks.value) {
    gradeError.value = `Score must be between 0 and ${maxMarks.value}.`
    return
  }
  grading.value = true
  try {
    await api.post(`/submissions/${submissionId.value}/grade`, {
      score: Number(gradeForm.score),
      feedback: gradeForm.feedback.trim(),
      evaluationId: gradeForm.evaluationId,
    })
    gradeNotice.value = 'Grade released — the student has been notified.'
    await load()
  } catch (cause) {
    gradeError.value = formatApiError(cause)
  } finally {
    grading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <ErrorBlock v-if="error" :error="error" title="Could not load the submission" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading submission…" />

    <template v-else-if="data">
      <div class="breadcrumbs">
        <router-link to="/app/grading">Grading queue</router-link>
        <span>›</span>
        <span>{{ data.student?.name }}</span>
        <span>›</span>
        <span>{{ data.assignment.title }}</span>
      </div>

      <div class="page-head">
        <div>
          <div style="display: flex; gap: 9px; align-items: center; flex-wrap: wrap">
            <h1 style="margin: 0">{{ data.assignment.title }}</h1>
            <StatusBadge :status="data.submission.status" />
            <span v-if="data.submission.isLate" class="badge badge-warning">late</span>
          </div>
          <p class="subtitle">
            {{ data.student?.name }} · {{ data.student?.email }} · submitted {{ formatDateTime(data.submission.submittedAt) }}
            <template v-if="data.submission.attempts > 1"> (attempt {{ data.submission.attempts }})</template>
          </p>
        </div>
        <div class="actions">
          <router-link class="btn" :to="`/app/assignments/${data.assignment.id}`">Assignment →</router-link>
        </div>
      </div>

      <div v-if="gradeError" class="error-banner"><span>{{ gradeError }}</span></div>
      <div v-if="gradeNotice" class="alert alert-success">{{ gradeNotice }}</div>
      <div v-if="evalError" class="error-banner"><span>{{ evalError }}</span></div>

      <div class="split-2">
        <!-- ===== submission ===== -->
        <div>
          <section class="card">
            <h3 class="card-title">Student's work</h3>
            <div v-if="data.submission.content" class="submission-text">{{ data.submission.content }}</div>
            <p v-else class="muted">No text answer provided.</p>
            <p v-if="data.submission.url" class="small" style="margin-top: 10px">
              🔗 <a :href="data.submission.url" target="_blank" rel="noopener noreferrer">{{ data.submission.url }}</a>
            </p>
            <p v-if="data.submission.fileName" class="small" style="margin-top: 6px">
              📎 {{ data.submission.fileName }}
              <span class="muted">({{ formatBytes(data.submission.fileSize) }})</span>
              <button
                class="btn btn-sm"
                type="button"
                style="margin-left: 8px"
                @click="downloadFile(`/submissions/${data.submission.id}/file`, data.submission.fileName!)"
              >
                Download
              </button>
            </p>
          </section>

          <section class="card">
            <h3 class="card-title">
              Instructions
              <span class="sub">{{ data.assignment.maxMarks }} marks max</span>
            </h3>
            <div class="lesson-content" style="font-size: 0.9rem" v-html="instructionsHtml" />
          </section>

          <section v-if="data.assignment.rubricItems.length > 0" class="card">
            <h3 class="card-title">Rubric</h3>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Criteria</th>
                    <th>Description</th>
                    <th class="num">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in data.assignment.rubricItems" :key="item.criteria + item.maxMarks">
                    <td><strong>{{ item.criteria }}</strong></td>
                    <td class="muted">{{ item.description || '—' }}</td>
                    <td class="num">{{ item.maxMarks }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <!-- ===== grading panel ===== -->
        <div>
          <section class="ai-panel mb-16">
            <h4>✦ AI Evaluation Assistant</h4>
            <p class="small" style="margin-bottom: 10px">
              The AI drafts a score with strengths and weaknesses. Nothing is published until you release the grade below.
            </p>

            <template v-if="latestEvaluation">
              <span class="score-chip">
                {{ latestEvaluation.suggestedScore }}<small>/{{ data.assignment.maxMarks }} suggested</small>
              </span>
              <StatusBadge :status="latestEvaluation.status" style="margin-left: 6px" />
              <dl>
                <dt>Strengths</dt>
                <dd>{{ latestEvaluation.strengths }}</dd>
                <dt>Weaknesses</dt>
                <dd>{{ latestEvaluation.weaknesses }}</dd>
                <dt>Suggested feedback</dt>
                <dd>{{ latestEvaluation.suggestionFeedback }}</dd>
              </dl>
              <div class="small muted">
                {{ latestEvaluation.provider ? `provider: ${latestEvaluation.provider} · ` : '' }}
                {{ formatRelative(latestEvaluation.createdAt) }}
              </div>
            </template>

            <button
              class="btn btn-primary btn-block"
              type="button"
              style="margin-top: 12px"
              :disabled="evaluating || data.submission.status === 'graded'"
              @click="runEvaluation()"
            >
              <span v-if="evaluating" class="spinner spinner-sm" />
              {{ evaluating ? 'Asking the AI…' : latestEvaluation ? 'Re-run AI evaluation' : 'Run AI evaluation' }}
            </button>
            <p v-if="data.submission.status === 'graded'" class="small muted" style="margin: 8px 0 0">
              This submission is graded. Re-run the assistant only if you plan to adjust the grade.
            </p>
          </section>

          <section class="card">
            <h3 class="card-title">
              Release grade
              <span v-if="data.submission.status === 'graded'" class="sub">
                currently {{ data.submission.score }}/{{ data.assignment.maxMarks }}
              </span>
            </h3>

            <form @submit.prevent="releaseGrade()">
              <div class="field">
                <label for="g-score">Score (0–{{ data.assignment.maxMarks }})</label>
                <input
                  id="g-score"
                  v-model.number="gradeForm.score"
                  type="number"
                  min="0"
                  :max="data.assignment.maxMarks"
                  required
                />
                <span v-if="gradeForm.evaluationId" class="hint">
                  Prefilled from the AI suggestion — edit freely. Your score decides whether the suggestion counts as
                  accepted or edited.
                </span>
              </div>
              <div class="field">
                <label for="g-feedback">Feedback to the student</label>
                <textarea
                  id="g-feedback"
                  v-model="gradeForm.feedback"
                  rows="6"
                  maxlength="4000"
                  placeholder="What did they do well? What should they improve?"
                />
              </div>
              <button class="btn btn-primary btn-block" type="submit" :disabled="grading || !data.canGrade">
                <span v-if="grading" class="spinner spinner-sm" />
                {{ data.submission.status === 'graded' ? 'Update & re-release grade' : 'Release grade' }}
              </button>
              <p v-if="!data.canGrade" class="small muted" style="margin-top: 8px">
                Only the assigned trainer or an admin can grade this submission.
              </p>
            </form>

            <template v-if="data.submission.status === 'graded'">
              <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0" />
              <dl class="kv">
                <dt>Released</dt>
                <dd>{{ data.submission.gradedAt ? formatDateTime(data.submission.gradedAt) : '—' }}</dd>
                <dt>Graded by</dt>
                <dd>{{ data.gradedBy?.name ?? '—' }}</dd>
                <dt>Feedback</dt>
                <dd style="white-space: pre-wrap">{{ data.submission.feedback || '—' }}</dd>
              </dl>
            </template>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
