<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, formatApiError } from '../api'
import type { Assignment, Paginated, ProgramDetail, ProgramStudent, RubricItem, User } from '../types'
import { fromLocalInput, formatDate } from '../format'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const programId = computed(() => Number(route.params.id))

const detail = ref<ProgramDetail | null>(null)
const roster = ref<ProgramStudent[]>([])
const loading = ref(true)
const error = ref<unknown>(null)
const tab = ref<'curriculum' | 'assignments' | 'people' | 'settings'>('curriculum')
const actionError = ref('')

const access = computed(() => detail.value?.access ?? 'student')
const canManage = computed(() => access.value === 'admin' || access.value === 'trainer')
const isAdmin = computed(() => access.value === 'admin')

// --- modals ---
const showModule = ref(false)
const showLesson = ref(false)
const showAssignment = ref(false)
const showCohort = ref(false)
const showEnroll = ref(false)

const moduleForm = reactive({ title: '', description: '', targetModule: 0 })
const lessonForm = reactive({ title: '', content: '', durationMinutes: 15, moduleId: 0 })
const assignmentForm = reactive({
  title: '',
  description: '',
  maxMarks: 20,
  dueAt: '',
  rubricItems: [] as { criteria: string; description: string; maxMarks: number }[],
})
const cohortForm = reactive({ name: '', startDate: '', endDate: '' })
const enrollForm = reactive({ cohortId: 0, studentIds: [] as number[] })

const studentsDirectory = ref<User[]>([])
const trainers = ref<User[]>([])
const studentSearch = ref('')

const settings = reactive({ title: '', description: '', level: 'beginner', trainerId: '' })
const busy = ref(false)
const modalError = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    detail.value = await api.get<ProgramDetail>(`/programs/${programId.value}`)
    const program = detail.value.program
    settings.title = program.title
    settings.description = program.description
    settings.level = program.level
    settings.trainerId = program.trainerId ? String(program.trainerId) : ''
    if (canManage.value) await loadRoster()
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

async function loadRoster(): Promise<void> {
  try {
    const result = await api.get<Paginated<ProgramStudent>>(`/programs/${programId.value}/students?limit=100`)
    roster.value = result.data
  } catch {
    roster.value = []
  }
}

async function ensureUsers(): Promise<void> {
  if (studentsDirectory.value.length > 0) return
  try {
    const [students, trainerRows] = await Promise.all([
      api.get<Paginated<User>>('/users?role=student&status=active&limit=100'),
      api.get<Paginated<User>>('/users?role=trainer&limit=100'),
    ])
    studentsDirectory.value = students.data
    trainers.value = trainerRows.data
  } catch {
    /* dropdowns stay empty */
  }
}

function flash(message: string): void {
  actionError.value = message
  window.setTimeout(() => {
    if (actionError.value === message) actionError.value = ''
  }, 6000)
}

// --- curriculum management ---
function openModule(): void {
  modalError.value = ''
  moduleForm.title = ''
  moduleForm.description = ''
  showModule.value = true
}

async function addModule(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    await api.post(`/programs/${programId.value}/modules`, {
      title: moduleForm.title.trim(),
      description: moduleForm.description.trim(),
    })
    showModule.value = false
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

function openLesson(moduleId: number): void {
  modalError.value = ''
  lessonForm.title = ''
  lessonForm.content = ''
  lessonForm.durationMinutes = 15
  lessonForm.moduleId = moduleId
  showLesson.value = true
}

async function addLesson(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    await api.post(`/modules/${lessonForm.moduleId}/lessons`, {
      title: lessonForm.title.trim(),
      content: lessonForm.content,
      durationMinutes: lessonForm.durationMinutes,
    })
    showLesson.value = false
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function deleteModule(moduleId: number, title: string): Promise<void> {
  if (!window.confirm(`Delete module “${title}” and all of its lessons?`)) return
  try {
    await api.del(`/modules/${moduleId}`)
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

async function deleteLesson(lessonId: number, title: string): Promise<void> {
  if (!window.confirm(`Delete lesson “${title}”?`)) return
  try {
    await api.del(`/lessons/${lessonId}`)
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

// --- assignments ---
function openAssignment(): void {
  modalError.value = ''
  assignmentForm.title = ''
  assignmentForm.description = ''
  assignmentForm.maxMarks = 20
  assignmentForm.dueAt = ''
  assignmentForm.rubricItems = [
    { criteria: 'Correctness', description: '', maxMarks: 12 },
    { criteria: 'Reasoning', description: '', maxMarks: 8 },
  ]
  showAssignment.value = true
}

function addRubricRow(): void {
  assignmentForm.rubricItems.push({ criteria: '', description: '', maxMarks: 5 })
}

function removeRubricRow(index: number): void {
  assignmentForm.rubricItems.splice(index, 1)
}

const rubricTotal = computed(() =>
  assignmentForm.rubricItems.reduce((total, item) => total + (Number(item.maxMarks) || 0), 0),
)

async function createAssignment(): Promise<void> {
  modalError.value = ''
  const items: RubricItem[] = assignmentForm.rubricItems
    .filter((item) => item.criteria.trim().length > 0)
    .map((item) => ({
      criteria: item.criteria.trim(),
      description: item.description.trim(),
      maxMarks: Number(item.maxMarks) || 0,
    }))
  busy.value = true
  try {
    await api.post(`/programs/${programId.value}/assignments`, {
      title: assignmentForm.title.trim(),
      description: assignmentForm.description,
      maxMarks: Number(assignmentForm.maxMarks) || 1,
      dueAt: fromLocalInput(assignmentForm.dueAt),
      rubricItems: items,
    })
    showAssignment.value = false
    tab.value = 'assignments'
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function togglePublish(assignment: Assignment): Promise<void> {
  try {
    await api.post(`/assignments/${assignment.id}/${assignment.status === 'published' ? 'unpublish' : 'publish'}`)
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

async function deleteAssignment(assignment: Assignment): Promise<void> {
  if (!window.confirm(`Delete assignment “${assignment.title}”?`)) return
  try {
    await api.del(`/assignments/${assignment.id}`)
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

// --- cohorts & enrollment ---
function openCohort(): void {
  modalError.value = ''
  cohortForm.name = ''
  cohortForm.startDate = ''
  cohortForm.endDate = ''
  showCohort.value = true
}

async function createCohort(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    await api.post('/cohorts', {
      programId: programId.value,
      name: cohortForm.name.trim(),
      startDate: cohortForm.startDate || null,
      endDate: cohortForm.endDate || null,
    })
    showCohort.value = false
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function openEnroll(): Promise<void> {
  modalError.value = ''
  enrollForm.studentIds = []
  studentSearch.value = ''
  await ensureUsers()
  const cohorts = detail.value?.cohorts ?? []
  enrollForm.cohortId = cohorts[0]?.id ?? 0
  showEnroll.value = true
}

const filteredStudents = computed(() => {
  const query = studentSearch.value.trim().toLowerCase()
  const enrolled = new Set(roster.value.map((student) => student.id))
  return studentsDirectory.value.filter((student) => {
    if (enrolled.has(student.id)) return false
    if (!query) return true
    return student.name.toLowerCase().includes(query) || student.email.toLowerCase().includes(query)
  })
})

function toggleStudent(id: number): void {
  const index = enrollForm.studentIds.indexOf(id)
  if (index >= 0) enrollForm.studentIds.splice(index, 1)
  else enrollForm.studentIds.push(id)
}

async function enrollStudents(): Promise<void> {
  modalError.value = ''
  if (enrollForm.cohortId === 0 || enrollForm.studentIds.length === 0) {
    modalError.value = 'Pick a cohort and at least one student.'
    return
  }
  busy.value = true
  try {
    await api.post(`/cohorts/${enrollForm.cohortId}/enrollments`, { studentIds: enrollForm.studentIds })
    showEnroll.value = false
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function unenroll(student: ProgramStudent): Promise<void> {
  if (!window.confirm(`Remove ${student.name} from this program?`)) return
  try {
    await api.del(`/enrollments/${student.id}`)
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

// --- settings ---
async function saveSettings(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    await api.patch(`/programs/${programId.value}`, {
      title: settings.title.trim(),
      description: settings.description,
      level: settings.level,
    })
    await load()
    flash('Program details saved.')
  } catch (cause) {
    flash(formatApiError(cause))
  } finally {
    busy.value = false
  }
}

async function setStatus(status: 'draft' | 'published'): Promise<void> {
  try {
    await api.patch(`/programs/${programId.value}`, { status })
    await load()
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

async function assignTrainer(): Promise<void> {
  busy.value = true
  try {
    await api.post(`/programs/${programId.value}/trainer`, {
      trainerId: settings.trainerId ? Number(settings.trainerId) : null,
    })
    await load()
    flash('Trainer assignment updated.')
  } catch (cause) {
    flash(formatApiError(cause))
  } finally {
    busy.value = false
  }
}

async function removeProgram(): Promise<void> {
  if (!window.confirm('Delete this program permanently? This cannot be undone.')) return
  try {
    await api.del(`/programs/${programId.value}`)
    router.push('/app/programs')
  } catch (cause) {
    flash(formatApiError(cause))
  }
}

onMounted(load)
</script>

<template>
  <div>
    <ErrorBlock v-if="error" :error="error" title="Could not load the program" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading program…" />

    <template v-else-if="detail">
      <div class="breadcrumbs">
        <router-link to="/app/programs">Programs</router-link>
        <span>›</span>
        <span>{{ detail.program.title }}</span>
      </div>

      <div class="page-head">
        <div>
          <div style="display: flex; gap: 9px; align-items: center; flex-wrap: wrap">
            <h1 style="margin: 0">{{ detail.program.title }}</h1>
            <StatusBadge :status="detail.program.status" />
            <span class="badge badge-primary">{{ detail.program.level }}</span>
          </div>
          <p class="subtitle">
            {{ detail.program.description || 'No description.' }}
          </p>
          <div class="small muted">
            <span v-if="detail.program.trainer">Trainer: {{ detail.program.trainer.name }} · </span>
            {{ detail.modules.length }} modules ·
            {{ detail.modules.reduce((n, m) => n + m.lessons.length, 0) }} lessons
            <template v-if="detail.cohorts.length > 0"> · {{ detail.cohorts.length }} cohorts</template>
          </div>
        </div>
        <div class="actions">
          <router-link class="btn" to="/app/assignments">Assignments →</router-link>
          <button v-if="canManage && detail.program.status === 'draft'" class="btn btn-primary" type="button" @click="setStatus('published')">
            Publish program
          </button>
          <button v-else-if="canManage && detail.program.status === 'published'" class="btn" type="button" @click="setStatus('draft')">
            Back to draft
          </button>
        </div>
      </div>

      <div v-if="actionError" class="error-banner"><span>{{ actionError }}</span></div>

      <div v-if="detail.progress" class="card mb-16">
        <div class="flex-between">
          <strong>Your progress</strong>
          <span class="small muted">{{ detail.progress.completedLessons }}/{{ detail.progress.totalLessons }} lessons</span>
        </div>
        <div style="margin-top: 10px">
          <ProgressBar :percent="detail.progress.percent" :success="detail.progress.percent === 100" />
        </div>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'curriculum' }" type="button" @click="tab = 'curriculum'">
          Curriculum
        </button>
        <button class="tab" :class="{ active: tab === 'assignments' }" type="button" @click="tab = 'assignments'">
          Assignments
          <span class="count">{{ detail.assignments.length }}</span>
        </button>
        <button
          v-if="canManage || roster.length > 0"
          class="tab"
          :class="{ active: tab === 'people' }"
          type="button"
          @click="tab = 'people'"
        >
          People
          <span class="count">{{ roster.length }}</span>
        </button>
        <button v-if="canManage" class="tab" :class="{ active: tab === 'settings' }" type="button" @click="tab = 'settings'">
          Settings
        </button>
      </div>

      <!-- ================= Curriculum ================= -->
      <section v-if="tab === 'curriculum'">
        <EmptyState
          v-if="detail.modules.length === 0"
          icon="▤"
          title="No content yet"
          :message="canManage ? 'Add the first module to start building this program.' : 'Your trainer has not published lessons yet.'"
        >
          <button v-if="canManage" class="btn btn-primary" type="button" @click="openModule()">+ Add module</button>
        </EmptyState>

        <div v-else style="display: flex; flex-direction: column; gap: 16px">
          <div v-for="module in detail.modules" :key="module.id" class="card">
            <div class="card-title">
              <span>
                {{ module.title }}
                <span v-if="module.progress" class="sub">
                  · {{ module.progress.completedLessons }}/{{ module.progress.totalLessons }} done
                </span>
              </span>
              <span style="display: flex; gap: 7px">
                <button v-if="canManage" class="btn btn-sm" type="button" @click="openLesson(module.id)">+ Lesson</button>
                <button v-if="canManage" class="btn btn-sm btn-ghost" type="button" @click="deleteModule(module.id, module.title)">
                  Delete
                </button>
              </span>
            </div>
            <p v-if="module.description" class="small muted" style="margin-top: -6px">{{ module.description }}</p>

            <div v-if="module.lessons.length === 0" class="small muted">No lessons in this module yet.</div>
            <div v-else class="list-rows">
              <div v-for="(lesson, index) in module.lessons" :key="lesson.id" class="list-row">
                <span :class="{ muted: !lesson.completed }" aria-hidden="true">
                  <span v-if="lesson.completed" style="color: var(--success)">✓</span>
                  <span v-else>{{ index + 1 }}.</span>
                </span>
                <div class="grow">
                  <router-link
                    class="title"
                    :to="`/app/programs/${detail.program.id}/modules/${module.id}/lessons/${lesson.id}`"
                  >
                    {{ lesson.title }}
                  </router-link>
                  <div class="sub">{{ lesson.durationMinutes }} min</div>
                </div>
                <button
                  v-if="canManage"
                  class="btn btn-sm btn-ghost"
                  type="button"
                  @click="deleteLesson(lesson.id, lesson.title)"
                >
                  Remove
                </button>
                <router-link
                  v-else
                  class="btn btn-sm"
                  :to="`/app/programs/${detail.program.id}/modules/${module.id}/lessons/${lesson.id}`"
                >
                  Open →
                </router-link>
              </div>
            </div>
          </div>

          <div v-if="canManage" style="text-align: center">
            <button class="btn" type="button" @click="openModule()">+ Add module</button>
          </div>
        </div>
      </section>

      <!-- ================= Assignments ================= -->
      <section v-else-if="tab === 'assignments'">
        <div v-if="canManage" class="flex-between mb-16">
          <span class="muted small">{{ detail.assignments.length }} assignments in this program</span>
          <button class="btn btn-primary" type="button" @click="openAssignment()">+ New assignment</button>
        </div>

        <EmptyState
          v-if="detail.assignments.length === 0"
          icon="✎"
          title="No assignments"
          :message="canManage ? 'Create one with a rubric so grading stays consistent.' : 'No assignments published yet.'"
        >
          <button v-if="canManage" class="btn btn-primary" type="button" @click="openAssignment()">+ New assignment</button>
        </EmptyState>

        <div v-else class="list-rows card">
          <div v-for="assignment in detail.assignments" :key="assignment.id" class="list-row">
            <div class="grow">
              <router-link class="title" :to="`/app/assignments/${assignment.id}`">{{ assignment.title }}</router-link>
              <div class="sub">
                {{ assignment.maxMarks }} marks
                <template v-if="assignment.dueAt"> · due {{ formatDate(assignment.dueAt) }}</template>
                <template v-if="assignment.rubricItems.length > 0"> · rubric {{ assignment.rubricItems.length }} criteria</template>
              </div>
            </div>
            <span v-if="access === 'student' && assignment.mySubmission" class="right">
              <StatusBadge :status="assignment.mySubmission.status" />
              <div class="small" style="margin-top: 4px">
                {{ assignment.mySubmission.score !== null ? `${assignment.mySubmission.score}/${assignment.maxMarks}` : 'awaiting grade' }}
              </div>
            </span>
            <span v-else-if="access === 'student'" class="right"><span class="badge badge-warning">Not submitted</span></span>
            <span v-else class="right">
              <StatusBadge :status="assignment.status" />
              <div class="small" style="margin-top: 4px">{{ assignment.gradedCount }}/{{ assignment.submissionCount }} graded</div>
            </span>
            <span v-if="canManage" style="display: flex; gap: 6px">
              <button class="btn btn-sm" type="button" @click="togglePublish(assignment)">
                {{ assignment.status === 'published' ? 'Unpublish' : 'Publish' }}
              </button>
              <button class="btn btn-sm btn-ghost" type="button" @click="deleteAssignment(assignment)">Delete</button>
            </span>
          </div>
        </div>
      </section>

      <!-- ================= People ================= -->
      <section v-else-if="tab === 'people'">
        <div class="flex-between mb-16">
          <span class="muted small">{{ roster.length }} enrolled students</span>
          <span v-if="isAdmin" style="display: flex; gap: 8px">
            <button class="btn" type="button" @click="openCohort()">+ Cohort</button>
            <button class="btn btn-primary" type="button" :disabled="detail.cohorts.length === 0" @click="openEnroll()">
              + Enroll students
            </button>
          </span>
        </div>

        <div v-if="detail.cohorts.length > 0" class="grid grid-3 mb-16">
          <div v-for="cohort in detail.cohorts" :key="cohort.id" class="card" style="padding: 14px 16px">
            <strong>{{ cohort.name }}</strong>
            <div class="small muted">
              {{ cohort.studentCount }} students
              <template v-if="cohort.startDate"> · {{ formatDate(cohort.startDate) }} → {{ formatDate(cohort.endDate) }}</template>
            </div>
          </div>
        </div>

        <EmptyState v-if="roster.length === 0" icon="☺" title="No students enrolled" message="Enroll students into a cohort to get started." />

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Cohort</th>
                <th>Enrolled</th>
                <th>Progress</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="student in roster" :key="student.id">
                <td>
                  <strong>{{ student.name }}</strong>
                  <div class="small muted">{{ student.email }}</div>
                </td>
                <td>{{ student.cohortName }}</td>
                <td class="nowrap">{{ formatDate(student.enrolledAt) }}</td>
                <td style="min-width: 170px">
                  <ProgressBar :percent="student.progress.percent" />
                  <div class="small muted">{{ student.progress.completedLessons }}/{{ student.progress.totalLessons }} lessons</div>
                </td>
                <td class="text-right">
                  <button v-if="isAdmin" class="btn btn-sm btn-ghost" type="button" @click="unenroll(student)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ================= Settings ================= -->
      <section v-else-if="tab === 'settings'">
        <div class="grid grid-2">
          <div class="card">
            <h3 class="card-title">Program details</h3>
            <form @submit.prevent="saveSettings()">
              <div class="field">
                <label for="s-title">Title</label>
                <input id="s-title" v-model="settings.title" type="text" minlength="3" maxlength="150" required />
              </div>
              <div class="field">
                <label for="s-desc">Description</label>
                <textarea id="s-desc" v-model="settings.description" rows="4" maxlength="4000" />
              </div>
              <div class="field">
                <label for="s-level">Level</label>
                <select id="s-level" v-model="settings.level">
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
              <button class="btn btn-primary" type="submit" :disabled="busy">Save changes</button>
            </form>
          </div>

          <div v-if="isAdmin" class="card">
            <h3 class="card-title">Trainer &amp; danger zone</h3>
            <div class="field">
              <label for="s-trainer">Assigned trainer</label>
              <select id="s-trainer" v-model="settings.trainerId">
                <option value="">— Unassigned —</option>
                <option v-for="trainer in trainers" :key="trainer.id" :value="String(trainer.id)">{{ trainer.name }}</option>
              </select>
              <span class="hint">Only the assigned trainer (plus admins) can edit this program's content.</span>
            </div>
            <button class="btn" type="button" :disabled="busy" @click="assignTrainer()">Save trainer</button>

            <hr style="border: none; border-top: 1px solid var(--border); margin: 18px 0" />
            <h4>Deleting the program</h4>
            <p class="small muted">
              Programs with enrolled students or existing submissions cannot be deleted — remove enrollments first.
            </p>
            <button class="btn btn-danger" type="button" @click="removeProgram()">Delete program</button>
          </div>
        </div>
      </section>

      <!-- ================= Modals ================= -->
      <ModalDialog v-if="showModule" title="Add module" @close="showModule = false">
        <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
        <form @submit.prevent="addModule()">
          <div class="field">
            <label for="m-title">Module title</label>
            <input id="m-title" v-model="moduleForm.title" type="text" minlength="2" maxlength="150" required placeholder="e.g. Foundations of ML" />
          </div>
          <div class="field">
            <label for="m-desc">Short description</label>
            <textarea id="m-desc" v-model="moduleForm.description" rows="2" maxlength="2000" />
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" @click="showModule = false">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="busy">Add module</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog v-if="showLesson" title="Add lesson" large @close="showLesson = false">
        <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
        <form @submit.prevent="addLesson()">
          <div class="field">
            <label for="l-title">Lesson title</label>
            <input id="l-title" v-model="lessonForm.title" type="text" minlength="2" maxlength="150" required />
          </div>
          <div class="field">
            <label for="l-content">Content (markdown supported)</label>
            <textarea id="l-content" v-model="lessonForm.content" rows="10" maxlength="50000" placeholder="## Objectives&#10;…" />
          </div>
          <div class="field">
            <label for="l-duration">Duration (minutes)</label>
            <input id="l-duration" v-model.number="lessonForm.durationMinutes" type="number" min="1" max="1000" />
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" @click="showLesson = false">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="busy">Add lesson</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog v-if="showAssignment" title="New assignment" large @close="showAssignment = false">
        <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
        <form @submit.prevent="createAssignment()">
          <div class="field">
            <label for="a-title">Title</label>
            <input id="a-title" v-model="assignmentForm.title" type="text" minlength="3" maxlength="150" required />
          </div>
          <div class="field">
            <label for="a-desc">Instructions</label>
            <textarea id="a-desc" v-model="assignmentForm.description" rows="4" maxlength="20000" />
          </div>
          <div class="field">
            <label for="a-marks">Maximum marks</label>
            <input id="a-marks" v-model.number="assignmentForm.maxMarks" type="number" min="1" max="1000" required />
          </div>
          <div class="field">
            <label for="a-due">Due date</label>
            <input id="a-due" v-model="assignmentForm.dueAt" type="datetime-local" />
            <span class="hint">Leave empty for no deadline.</span>
          </div>

          <label style="font-size: 0.84rem; font-weight: 600; color: var(--text-muted)">Rubric</label>
          <div
            v-for="(item, index) in assignmentForm.rubricItems"
            :key="index"
            style="display: grid; grid-template-columns: 1fr 1fr 84px auto; gap: 8px; margin-bottom: 8px; align-items: center"
          >
            <input v-model="item.criteria" type="text" placeholder="Criteria" maxlength="200" />
            <input v-model="item.description" type="text" placeholder="Description (optional)" maxlength="1000" />
            <input v-model.number="item.maxMarks" type="number" min="1" max="1000" aria-label="Max marks" />
            <button class="btn btn-sm btn-ghost" type="button" @click="removeRubricRow(index)">✕</button>
          </div>
          <div class="flex-between" style="margin-bottom: 14px">
            <button class="btn btn-sm" type="button" @click="addRubricRow()">+ Add criteria</button>
            <span class="small muted" :style="{ color: rubricTotal > assignmentForm.maxMarks ? 'var(--danger)' : '' }">
              Rubric total: {{ rubricTotal }} / {{ assignmentForm.maxMarks }}
            </span>
          </div>

          <div class="modal-actions">
            <button class="btn" type="button" @click="showAssignment = false">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="busy">Create draft</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog v-if="showCohort" title="Create cohort" @close="showCohort = false">
        <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
        <form @submit.prevent="createCohort()">
          <div class="field">
            <label for="c-name">Cohort name</label>
            <input id="c-name" v-model="cohortForm.name" type="text" minlength="2" maxlength="100" required placeholder="e.g. Batch 02" />
          </div>
          <div class="field">
            <label for="c-start">Start date</label>
            <input id="c-start" v-model="cohortForm.startDate" type="date" />
          </div>
          <div class="field">
            <label for="c-end">End date</label>
            <input id="c-end" v-model="cohortForm.endDate" type="date" />
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" @click="showCohort = false">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="busy">Create cohort</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog v-if="showEnroll" title="Enroll students" large @close="showEnroll = false">
        <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
        <form @submit.prevent="enrollStudents()">
          <div class="field">
            <label for="e-cohort">Cohort</label>
            <select id="e-cohort" v-model.number="enrollForm.cohortId" required>
              <option v-for="cohort in detail.cohorts" :key="cohort.id" :value="cohort.id">{{ cohort.name }}</option>
            </select>
          </div>
          <div class="field">
            <label for="e-search">Search students</label>
            <input id="e-search" v-model="studentSearch" type="search" placeholder="Name or email…" />
          </div>
          <div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px">
            <EmptyState v-if="filteredStudents.length === 0" title="No matching students" message="Everyone matching may already be enrolled." />
            <label
              v-for="student in filteredStudents"
              :key="student.id"
              class="checkbox-row"
              style="margin: 0; padding: 9px 13px; border-bottom: 1px solid var(--border)"
            >
              <input type="checkbox" :checked="enrollForm.studentIds.includes(student.id)" @change="toggleStudent(student.id)" />
              <span>{{ student.name }} <span class="muted small">({{ student.email }})</span></span>
            </label>
          </div>
          <p class="small muted" style="margin-top: 10px">{{ enrollForm.studentIds.length }} selected</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="showEnroll = false">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="busy || enrollForm.studentIds.length === 0">
              Enroll {{ enrollForm.studentIds.length || '' }}
            </button>
          </div>
        </form>
      </ModalDialog>
    </template>
  </div>
</template>
