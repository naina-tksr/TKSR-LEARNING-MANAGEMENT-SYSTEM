<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, formatApiError, assignmentTaskApi } from '../api'
import type { Assignment, Paginated, SubmissionListItem, AssignmentTask, TaskResponse } from '../types'
import { downloadFile } from '../api'
import { renderMarkdown } from '../markdown'
import { formatDate, formatDateTime, formatRelative, isPast } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import StatusBadge from '../components/StatusBadge.vue'
import PaginationBar from '../components/PaginationBar.vue'
import EmptyState from '../components/EmptyState.vue'
import ModalDialog from '../components/ModalDialog.vue'

interface AssignmentResponse {
  assignment: Assignment & {
    tasks?: AssignmentTask[]
    myTaskResponses?: TaskResponse[]
  }
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

// tasks
const taskResponses = ref<Record<number, string>>({}) // taskId -> response text

const isStudent = computed(() => data.value?.access === 'student')
const canManage = computed(() => data.value?.access === 'admin' || data.value?.access === 'trainer')
const assignment = computed(() => data.value?.assignment ?? null)
const rendered = computed(() => renderMarkdown(assignment.value?.description ?? ''))
const tasks = computed(() => assignment.value?.tasks ?? [])
const myTaskResponses = computed(() => assignment.value?.myTaskResponses ?? [])

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
    // Also include task responses if any
    const taskResponsesArray = Object.entries(taskResponses.value).map(([taskId, responseText]) => ({
      taskId: Number(taskId),
      responseText,
    }))
    if (taskResponsesArray.length > 0) {
      payload.append('taskResponses', JSON.stringify(taskResponsesArray))
    }
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
  if (!window.confirm(`Delete "${assignment.value.title}"?`)) return
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

// Task management (trainer/admin)
const manageTasksModal = ref(false)
const taskForms = ref<Array<{ prompt: string; format: 'text' | 'mixed' | 'url' | 'file'; required: boolean; maxMarks: number }>>([])

function openManageTasks() {
  taskForms.value = (tasks.value || []).map(t => ({
    prompt: t.prompt,
    format: t.format,
    required: t.required,
    maxMarks: t.maxMarks,
  }))
  if (taskForms.value.length === 0) {
    taskForms.value.push({ prompt: '', format: 'text', required: true, maxMarks: 10 })
  }
  manageTasksModal.value = true
}

// Used in template (manage tasks modal)
function addTaskForm() {
  taskForms.value.push({ prompt: '', format: 'text', required: true, maxMarks: 10 })
}
void addTaskForm

// Used in template (manage tasks modal)
function removeTaskForm(index: number) {
  taskForms.value.splice(index, 1)
}
void removeTaskForm

// Used in template (manage tasks modal form submit)
async function saveTasks() {
  try {
    const validTasks = taskForms.value
      .filter(t => t.prompt.trim() && t.maxMarks > 0)
      .map((t, index) => ({
        id: 0,
        assignmentId: assignmentId.value,
        position: index + 1,
        prompt: t.prompt,
        format: t.format,
        required: t.required,
        maxMarks: t.maxMarks,
      }))
    await assignmentTaskApi.replace(assignmentId.value, validTasks)
    manageTasksModal.value = false
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}
void saveTasks

// Student: get existing task response
function getMyTaskResponse(taskId: number): string {
  const resp = myTaskResponses.value.find(r => r.taskId === taskId)
  return resp?.responseText ?? ''
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
          <button class="btn" type="button" @click="openManageTasks()">Manage Tasks</button>
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

          <!-- Tasks (for students and trainers) -->
          <section v-if="tasks.length > 0" class="card">
            <h3 class="card-title">
              Tasks
              <span class="sub">{{ tasks.length }} part{{ tasks.length !== 1 ? 's' : '' }}</span>
            </h3>
            <div v-for="task in tasks" :key="task.id" class="task-card" style="border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
              <div style="display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 280px;">
                  <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                    <strong>Task {{ task.position }}: {{ task.prompt }}</strong>
                    <span class="badge" :class="task.format === 'file' ? 'badge-info' : task.format === 'url' ? 'badge-success' : 'badge-warning'">
                      {{ task.format.toUpperCase() }}
                    </span>
                    <span v-if="task.required" class="badge badge-danger">Required</span>
                    <span class="badge muted">{{ task.maxMarks }} marks</span>
                  </div>
                  <p class="muted small" style="margin: 0;">{{ task.format === 'text' ? 'Written response expected' : task.format === 'mixed' ? 'Text and/or file upload' : task.format === 'url' ? 'Submit a link (GitHub, Drive, etc.)' : 'File upload only' }}</p>
                </div>
                <div v-if="isStudent && (!data.mySubmission || data.mySubmission.status !== 'graded')" style="min-width: 200px;">
                  <textarea
                    v-model="taskResponses[task.id]"
                    :placeholder="task.format === 'url' ? 'Paste your link here…' : 'Your answer…'"
                    rows="3"
                    class="task-input"
                    style="width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); color: var(--text); resize: vertical;"
                  />
                </div>
                <div v-else-if="isStudent && data.mySubmission" style="min-width: 200px;">
                  <div class="small" style="white-space: pre-wrap; background: var(--surface-2); padding: 0.5rem; border-radius: 4px;">
                    {{ getMyTaskResponse(task.id) || '—' }}
                  </div>
                  <p v-if="getMyTaskResponse(task.id)" class="small muted">Submitted</p>
                </div>
                <div v-else-if="canManage" style="min-width: 200px; text-align: right;">
                  <span class="badge" :class="['badge-' + (task.required ? 'danger' : 'info')]">
                    {{ task.required ? 'Required' : 'Optional' }}
                  </span>
                </div>
              </div>
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

  <!-- Manage Tasks Modal (admin/trainer only) -->
  <ModalDialog v-if="canManage" v-model:open="manageTasksModal" title="Manage Tasks" size="xl">
    <template #default>
      <form @submit.prevent="saveTasks" class="form-grid">
        <div v-for="(taskForm, index) in taskForms" :key="index" class="task-form-row" style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 120px 100px 100px auto; gap: 0.5rem; align-items: end; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2);">
          <div class="field" style="margin: 0;">
            <label>Prompt *</label>
            <input v-model="taskForm.prompt" type="text" required placeholder="e.g. Explain the concept of gradient descent" />
          </div>
          <div class="field" style="margin: 0;">
            <label>Format</label>
            <select v-model="taskForm.format" class="select">
              <option value="text">Text</option>
              <option value="mixed">Text + File</option>
              <option value="url">Link</option>
              <option value="file">File only</option>
            </select>
          </div>
          <div class="field" style="margin: 0;">
            <label>Max Marks *</label>
            <input v-model.number="taskForm.maxMarks" type="number" min="1" max="100" required class="select" />
          </div>
          <div class="field" style="margin: 0;">
            <label>Required</label>
            <select v-model="taskForm.required" class="select">
              <option :value="true">Yes</option>
              <option :value="false">No</option>
            </select>
          </div>
          <button v-if="taskForms.length > 1" type="button" class="btn btn-ghost btn-sm" @click="removeTaskForm(index)" style="height: fit-content;">Remove</button>
        </div>
        <button type="button" class="btn btn-secondary" @click="addTaskForm" style="grid-column: 1 / -1; justify-self: start; margin-top: 0.5rem;">+ Add Task</button>
        <div class="flex gap-2" style="grid-column: 1 / -1; margin-top: 1rem; justify-content: flex-end;">
          <button type="button" class="btn btn-ghost" @click="manageTasksModal = false">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Tasks</button>
        </div>
      </form>
    </template>
  </ModalDialog>
</template>
