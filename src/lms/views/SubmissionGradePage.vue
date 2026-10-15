<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, downloadFile, formatApiError, submissionTaskApi } from '../api'
import type { SubmissionDetailWithTasks, TaskResponse } from '../types'
import { formatBytes, formatDateTime, formatRelative } from '../format'
import { renderMarkdown } from '../markdown'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const submissionId = computed(() => Number(route.params.id))

const data = ref<SubmissionDetailWithTasks | null>(null)
const loading = ref(true)
const error = ref<unknown>(null)

const evaluating = ref(false)
const evalError = ref('')
const grading = ref(false)
const gradeError = ref('')
const gradeNotice = ref('')

const gradeForm = reactive({ score: 0, feedback: '', evaluationId: undefined as number | undefined })

// Task grades
const taskGrades = ref<Record<number, { score: number; feedback: string }>>({})
const taskGrading = ref(false)
const taskGradeError = ref('')

// Helpers for task grade inputs (avoid v-model on optional chaining)
function getTaskScore(taskId: number): number {
  return taskGrades.value[taskId]?.score ?? 0
}
function setTaskScore(taskId: number, score: number) {
  if (!taskGrades.value[taskId]) taskGrades.value[taskId] = { score: 0, feedback: '' }
  taskGrades.value[taskId].score = score
}
function getTaskFeedback(taskId: number): string {
  return taskGrades.value[taskId]?.feedback ?? ''
}
function setTaskFeedback(taskId: number, feedback: string) {
  if (!taskGrades.value[taskId]) taskGrades.value[taskId] = { score: 0, feedback: '' }
  taskGrades.value[taskId].feedback = feedback
}

const latestEvaluation = computed(() => data.value?.evaluations[0] ?? null)
const maxMarks = computed(() => data.value?.assignment.maxMarks ?? 100)
const instructionsHtml = computed(() => renderMarkdown(data.value?.assignment.description ?? ''))
const tasks = computed(() => data.value?.tasks ?? [])
const taskResponses = computed(() => data.value?.taskResponses ?? [])
const taskCompletion = computed(() => data.value?.taskCompletion)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<SubmissionDetailWithTasks>(`/submissions/${submissionId.value}`)
    const submission = data.value.submission
    const suggestion = data.value.evaluations.find((item) => item.source === 'ai')
    gradeForm.score =
      submission.status === 'graded' && submission.score !== null
        ? submission.score
        : (suggestion?.suggestedScore ?? Math.round(maxMarks.value * 0.7))
    gradeForm.feedback = submission.feedback ?? ''
    gradeForm.evaluationId = suggestion?.source === 'ai' ? suggestion.id : undefined

    // Initialize task grades from existing responses
    for (const resp of taskResponses.value) {
      if (resp.score !== null) {
        taskGrades.value[resp.taskId] = { score: resp.score, feedback: resp.feedback ?? '' }
      }
    }
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

async function saveTaskGrades(): Promise<void> {
  taskGradeError.value = ''
  taskGrading.value = true
  try {
    const grades = Object.entries(taskGrades.value).map(([taskId, g]) => ({
      taskId: Number(taskId),
      score: g.score,
      feedback: g.feedback,
    }))
    await submissionTaskApi.grade(submissionId.value, grades)
    taskGradeError.value = 'Task scores saved.'
    await load()
  } catch (cause) {
    taskGradeError.value = formatApiError(cause)
  } finally {
    taskGrading.value = false
  }
}

function getTaskResponse(taskId: number): TaskResponse | undefined {
  return taskResponses.value.find(r => r.taskId === taskId)
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

          <!-- Task Grading -->
          <section v-if="tasks.length > 0" class="card">
            <h3 class="card-title">
              Task Breakdown
              <span class="sub">{{ taskCompletion?.requiredAssessed ?? 0 }}/{{ taskCompletion?.requiredTotal ?? 0 }} required tasks assessed</span>
            </h3>
            <div v-if="taskCompletion && !taskCompletion.hasTasks" class="muted small">
              This assignment has no structured tasks. Use the rubric and overall grade above.
            </div>
            <div v-else>
              <div v-for="task in tasks" :key="task.id" class="task-grade-row" style="border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; background: var(--surface-2);">
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-start;">
                  <div style="flex: 1; min-width: 280px;">
                    <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                      <strong>Task {{ task.position }}: {{ task.prompt }}</strong>
                      <span class="badge" :class="task.format === 'file' ? 'badge-info' : task.format === 'url' ? 'badge-success' : 'badge-warning'">
                        {{ task.format.toUpperCase() }}
                      </span>
                      <span v-if="task.required" class="badge badge-danger">Required</span>
                      <span class="badge muted">{{ task.maxMarks }} marks</span>
                    </div>
                    <div v-if="getTaskResponse(task.id)" class="small" style="white-space: pre-wrap; background: var(--surface-3); padding: 0.5rem; border-radius: 4px;">
                      {{ getTaskResponse(task.id)!.responseText || 'No response provided' }}
                    </div>
                    <p v-else class="muted small">No response submitted</p>
                  </div>
                  <div style="min-width: 280px; display: flex; flex-direction: column; gap: 0.5rem;">
                    <div class="field" style="margin: 0;">
                      <label>Score (0–{{ task.maxMarks }})</label>
                      <input
                        :value="getTaskScore(task.id)"
                        @input="setTaskScore(task.id, Number(($event.target as HTMLInputElement).value))"
                        type="number"
                        :min="0"
                        :max="task.maxMarks"
                        step="1"
                        class="select"
                      />
                    </div>
                    <div class="field" style="margin: 0;">
                      <label>Feedback (optional)</label>
                      <textarea
                        :value="getTaskFeedback(task.id)"
                        @input="setTaskFeedback(task.id, ($event.target as HTMLTextAreaElement).value)"
                        rows="2"
                        class="select"
                        placeholder="Specific feedback for this task…"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex gap-2" style="margin-top: 1rem; justify-content: flex-end;">
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="taskGrading || !data.canGrade"
                  @click="saveTaskGrades"
                >
                  <span v-if="taskGrading" class="spinner spinner-sm" />
                  Save Task Scores
                </button>
              </div>
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
