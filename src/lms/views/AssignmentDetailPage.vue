<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, formatApiError } from '../api'
import type { Assignment, Paginated, SubmissionListItem } from '../types'
import { downloadFile } from '../api'
import { renderMarkdown } from '../markdown'
import { formatDate, formatDateTime, formatRelative, isPast } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import StatusBadge from '../components/StatusBadge.vue'
import PaginationBar from '../components/PaginationBar.vue'
import EmptyState from '../components/EmptyState.vue'

interface AssignmentResponse {
  assignment: Assignment
  program: { id: number; title: string; status: string }
  access: 'admin' | 'trainer' | 'student'
  mySubmission?: {
    id: number
    content: string
    url: string | null
    fileName: string | null
    fileSize: number | null
    status: 'submitted' | 'graded'
    score: number | null
    feedback: string | null
    isLate: boolean
    attempts: number
    submittedAt: string
    gradedAt: string | null
  } | null
  stats?: { submissionCount: number; gradedCount: number; lateCount: number }
}

const route = useRoute()
const assignmentId = computed(() => Number(route.params.id))

const data = ref<AssignmentResponse | null>(null)
const loading = ref(true)
const error = ref<unknown>(null)

const submissions = ref<SubmissionListItem[]>([])
const submissionsMeta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const submissionPage = ref(1)
const statusFilter = ref('')

// submission form
const form = reactive({ text: '', url: '', file: null as File | null })
const submitting = ref(false)
const formError = ref('')
const formNotice = ref('')

const isStudent = computed(() => data.value?.access === 'student')
const canManage = computed(() => data.value?.access === 'admin' || data.value?.access === 'trainer')
const assignment = computed(() => data.value?.assignment ?? null)
const rendered = computed(() => renderMarkdown(assignment.value?.description ?? ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<AssignmentResponse>(`/assignments/${assignmentId.value}`)
    if (canManage.value) await loadSubmissions()
    const mine = data.value.mySubmission
    if (mine) {
      form.text = mine.content ?? ''
      form.url = mine.url ?? ''
    }
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

async function loadSubmissions(): Promise<void> {
  try {
    const params = new URLSearchParams({ page: String(submissionPage.value), limit: '15' })
    if (statusFilter.value) params.set('status', statusFilter.value)
    const result = await api.get<{ assignment: Assignment; submissions: Paginated<SubmissionListItem> }>(
      `/assignments/${assignmentId.value}/submissions?${params}`,
    )
    submissions.value = result.submissions.data
    submissionsMeta.value = result.submissions.meta
  } catch {
    submissions.value = []
  }
}

function onFilePicked(event: Event): void {
  const input = event.target as HTMLInputElement
  form.file = input.files && input.files.length > 0 ? input.files[0] : null
}

async function submit(): Promise<void> {
  formError.value = ''
  formNotice.value = ''
  if (!form.text.trim() && !form.url.trim() && !form.file) {
    formError.value = 'Provide a text answer, a link, or a file attachment.'
    return
  }
  submitting.value = true
  try {
    const payload = new FormData()
    if (form.text.trim()) payload.append('text', form.text.trim())
    if (form.url.trim()) payload.append('url', form.url.trim())
    if (form.file) payload.append('file', form.file)
    const result = await api.send<{ submission: { attempts: number } }>(
      'POST',
      `/assignments/${assignmentId.value}/submissions`,
      payload,
    )
    formNotice.value = `Submitted (attempt ${result.submission.attempts}). You can resubmit until it is graded.`
    await load()
  } catch (cause) {
    formError.value = formatApiError(cause)
  } finally {
    submitting.value = false
  }
}

async function togglePublish(): Promise<void> {
  if (!assignment.value) return
  try {
    await api.post(`/assignments/${assignment.value.id}/${assignment.value.status === 'published' ? 'unpublish' : 'publish'}`)
    await load()
  } catch (cause) {
    formError.value = formatApiError(cause)
  }
}

async function removeAssignment(): Promise<void> {
  if (!assignment.value) return
  if (!window.confirm(`Delete “${assignment.value.title}”?`)) return
  try {
    await api.del(`/assignments/${assignment.value.id}`)
    window.history.back()
  } catch (cause) {
    formError.value = formatApiError(cause)
  }
}

async function gotoSubmissionPage(target: number): Promise<void> {
  submissionPage.value = target
  await loadSubmissions()
}

onMounted(load)
</script>

<template>
  <div>
    <ErrorBlock v-if="error" :error="error" title="Could not load the assignment" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading assignment…" />

    <template v-else-if="data && assignment">
      <div class="breadcrumbs">
        <router-link to="/app/programs">Programs</router-link>
        <span>›</span>
        <router-link :to="`/app/programs/${data.program.id}`">{{ data.program.title }}</router-link>
        <span>›</span>
        <span>{{ assignment.title }}</span>
      </div>

      <div class="page-head">
        <div>
          <div style="display: flex; gap: 9px; align-items: center; flex-wrap: wrap">
            <h1 style="margin: 0">{{ assignment.title }}</h1>
            <StatusBadge v-if="!isStudent" :status="assignment.status" />
            <span v-if="isPast(assignment.dueAt)" class="badge badge-danger">Past due</span>
          </div>
          <p class="subtitle">
            {{ assignment.maxMarks }} marks
            <template v-if="assignment.dueAt"> · due {{ formatDateTime(assignment.dueAt) }} ({{ formatRelative(assignment.dueAt) }})</template>
            <template v-else> · no deadline</template>
          </p>
        </div>
        <div v-if="canManage" class="actions">
          <button class="btn" type="button" @click="togglePublish()">
            {{ assignment.status === 'published' ? 'Unpublish' : 'Publish' }}
          </button>
          <button class="btn btn-danger" type="button" @click="removeAssignment()">Delete</button>
        </div>
      </div>

      <div v-if="formError" class="error-banner"><span>{{ formError }}</span></div>
      <div v-if="formNotice" class="alert alert-success">{{ formNotice }}</div>

      <div class="split-2">
        <!-- ============ main column ============ -->
        <div>
          <section class="card">
            <h3 class="card-title">Instructions</h3>
            <div v-if="assignment.description" class="lesson-content" style="font-size: 0.93rem" v-html="rendered" />
            <p v-else class="muted">No instructions provided.</p>
          </section>

          <section v-if="assignment.rubricItems.length > 0" class="card">
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
                  <tr v-for="item in assignment.rubricItems" :key="item.criteria + item.maxMarks">
                    <td><strong>{{ item.criteria }}</strong></td>
                    <td class="muted">{{ item.description || '—' }}</td>
                    <td class="num">{{ item.maxMarks }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Student: submission history + grade -->
          <section v-if="isStudent && data.mySubmission" class="card">
            <h3 class="card-title">
              Your submission
              <StatusBadge :status="data.mySubmission.status" />
            </h3>
            <div class="small muted" style="margin-bottom: 10px">
              Submitted {{ formatDateTime(data.mySubmission.submittedAt) }}
              <span v-if="data.mySubmission.attempts > 1"> · attempt {{ data.mySubmission.attempts }}</span>
              <span v-if="data.mySubmission.isLate" class="badge badge-warning" style="margin-left: 5px">late</span>
            </div>
            <div v-if="data.mySubmission.content" class="submission-text">{{ data.mySubmission.content }}</div>
            <p v-if="data.mySubmission.url" class="small">
              🔗 <a :href="data.mySubmission.url" target="_blank" rel="noopener noreferrer">{{ data.mySubmission.url }}</a>
            </p>
            <p v-if="data.mySubmission.fileName" class="small">
              📎 {{ data.mySubmission.fileName }}
              <button class="btn btn-sm" type="button" style="margin-left: 8px" @click="downloadFile(`/submissions/${data.mySubmission!.id}/file`, data.mySubmission!.fileName!)">
                Download
              </button>
            </p>

            <div
              v-if="data.mySubmission.status === 'graded'"
              class="alert alert-success"
              style="margin-top: 14px; margin-bottom: 0"
            >
              <strong>Grade: {{ data.mySubmission.score }}/{{ assignment.maxMarks }}</strong>
              <div v-if="data.mySubmission.feedback" style="margin-top: 6px; white-space: pre-wrap">{{ data.mySubmission.feedback }}</div>
              <div v-if="data.mySubmission.gradedAt" class="small" style="margin-top: 6px; opacity: 0.8">
                Released {{ formatDateTime(data.mySubmission.gradedAt) }}
              </div>
            </div>
          </section>

          <!-- Trainer: submissions -->
          <section v-if="canManage" class="card">
            <h3 class="card-title">
              Submissions
              <span class="sub">
                {{ data.stats?.submissionCount ?? 0 }} total · {{ data.stats?.gradedCount ?? 0 }} graded ·
                {{ data.stats?.lateCount ?? 0 }} late
              </span>
            </h3>

            <div class="toolbar">
              <select v-model="statusFilter" @change="submissionPage = 1; loadSubmissions()">
                <option value="">All submissions</option>
                <option value="submitted">Awaiting grade</option>
                <option value="graded">Graded</option>
              </select>
            </div>

            <EmptyState
              v-if="submissions.length === 0"
              icon="↧"
              title="No submissions yet"
              message="Student work will appear here once they submit."
            />
            <div v-else class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th class="num">Score</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="submission in submissions" :key="submission.id">
                    <td>
                      <strong>{{ submission.studentName }}</strong>
                      <div class="small muted">{{ submission.studentEmail }}</div>
                    </td>
                    <td class="nowrap">{{ formatRelative(submission.submittedAt) }}</td>
                    <td>
                      <StatusBadge :status="submission.status" />
                      <span v-if="submission.isLate" class="badge badge-warning" style="margin-left: 5px">late</span>
                    </td>
                    <td class="num">
                      {{ submission.score ?? '—' }}<span class="muted">/{{ assignment.maxMarks }}</span>
                    </td>
                    <td class="text-right">
                      <router-link class="btn btn-sm btn-primary" :to="`/app/grading/${submission.id}`">
                        {{ submission.status === 'graded' ? 'Review' : 'Grade' }}
                      </router-link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <PaginationBar :meta="submissionsMeta" @page="gotoSubmissionPage" />
          </section>
        </div>

        <!-- ============ side column ============ -->
        <div>
          <!-- Student: submit form -->
          <section v-if="isStudent && (!data.mySubmission || data.mySubmission.status !== 'graded')" class="card">
            <h3 class="card-title">{{ data.mySubmission ? 'Update your submission' : 'Submit your work' }}</h3>
            <form @submit.prevent="submit()">
              <div class="field">
                <label for="s-text">Your answer</label>
                <textarea
                  id="s-text"
                  v-model="form.text"
                  rows="8"
                  maxlength="20000"
                  placeholder="Write your answer, paste your code, or describe your approach…"
                />
              </div>
              <div class="field">
                <label for="s-url">Link (optional)</label>
                <input id="s-url" v-model="form.url" type="url" placeholder="https://github.com/…" />
              </div>
              <div class="field">
                <label for="s-file">Attachment (optional)</label>
                <input id="s-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.zip,.csv,.json,.py,.ipynb" @change="onFilePicked" />
                <span class="hint">PDF, images, text, notebooks, archives — max 5 MB.</span>
              </div>
              <button class="btn btn-primary btn-block" type="submit" :disabled="submitting">
                <span v-if="submitting" class="spinner spinner-sm" />
                {{ data.mySubmission ? 'Resubmit' : 'Submit assignment' }}
              </button>
              <p v-if="data.mySubmission" class="hint small muted" style="margin-top: 8px">
                Resubmission is allowed until a trainer grades your work.
              </p>
            </form>
          </section>

          <section class="card">
            <h3 class="card-title">At a glance</h3>
            <dl class="kv">
              <dt>Program</dt>
              <dd><router-link :to="`/app/programs/${data.program.id}`">{{ data.program.title }}</router-link></dd>
              <dt>Status</dt>
              <dd><StatusBadge :status="assignment.status" /></dd>
              <dt>Maximum marks</dt>
              <dd>{{ assignment.maxMarks }}</dd>
              <dt>Due</dt>
              <dd>{{ assignment.dueAt ? formatDate(assignment.dueAt) : 'No deadline' }}</dd>
              <dt v-if="data.stats">Submissions</dt>
              <dd v-if="data.stats">{{ data.stats.submissionCount }} ({{ data.stats.gradedCount }} graded)</dd>
            </dl>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
