<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api, formatApiError } from '../api'
import type { Cohort, Paginated, ProgramListItem, User } from '../types'
import { formatDate } from '../format'
import ModalDialog from '../components/ModalDialog.vue'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

interface CohortStudent {
  id: number
  name: string
  email: string
  enrolledAt: string
  enrollmentId: number
}

const cohorts = ref<Cohort[]>([])
const meta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const programFilter = ref('')
const programs = ref<ProgramListItem[]>([])
const flash = ref('')

const showCreate = ref(false)
const showRoster = ref(false)
const showEnroll = ref(false)
const modalError = ref('')
const busy = ref(false)

const createForm = reactive({ programId: '', name: '', startDate: '', endDate: '' })

const roster = ref<CohortStudent[]>([])
const rosterCohort = ref<Cohort | null>(null)
const rosterLoading = ref(false)

const enrollCohort = ref<Cohort | null>(null)
const studentsDirectory = ref<User[]>([])
const selectedIds = ref<number[]>([])
const studentSearch = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '15' })
    if (programFilter.value) params.set('programId', programFilter.value)
    const result = await api.get<Paginated<Cohort>>(`/cohorts?${params}`)
    cohorts.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

async function loadPrograms(): Promise<void> {
  if (programs.value.length > 0) return
  try {
    const result = await api.get<Paginated<ProgramListItem>>('/programs?limit=100')
    programs.value = result.data
  } catch {
    /* filter stays empty */
  }
}

watch([page, programFilter], () => void load())

function openCreate(): void {
  Object.assign(createForm, { programId: programs.value[0]?.id ? String(programs.value[0].id) : '', name: '', startDate: '', endDate: '' })
  modalError.value = ''
  showCreate.value = true
}

async function createCohort(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    await api.post('/cohorts', {
      programId: Number(createForm.programId),
      name: createForm.name.trim(),
      startDate: createForm.startDate || undefined,
      endDate: createForm.endDate || undefined,
    })
    showCreate.value = false
    flash.value = 'Cohort created.'
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function openRoster(cohort: Cohort): Promise<void> {
  rosterCohort.value = cohort
  roster.value = []
  modalError.value = ''
  showRoster.value = true
  rosterLoading.value = true
  try {
    const result = await api.get<{ cohort: Cohort; students: Paginated<CohortStudent> }>(`/cohorts/${cohort.id}?limit=100`)
    roster.value = result.students.data
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    rosterLoading.value = false
  }
}

async function openEnroll(cohort: Cohort): Promise<void> {
  enrollCohort.value = cohort
  selectedIds.value = []
  studentSearch.value = ''
  modalError.value = ''
  busy.value = false
  showEnroll.value = true
  if (studentsDirectory.value.length === 0) {
    try {
      const result = await api.get<Paginated<User>>('/users?role=student&status=active&limit=100')
      studentsDirectory.value = result.data
    } catch (cause) {
      modalError.value = formatApiError(cause)
    }
  }
}

const availableStudents = ref<User[]>([])
watch(showEnroll, async (open) => {
  if (!open || !enrollCohort.value) return
  try {
    const result = await api.get<{ students: Paginated<CohortStudent> }>(`/cohorts/${enrollCohort.value.id}?limit=100`)
    const enrolledIds = new Set(result.students.data.map((student) => student.id))
    availableStudents.value = studentsDirectory.value.filter((student) => !enrolledIds.has(student.id))
  } catch {
    availableStudents.value = studentsDirectory.value
  }
})

function toggle(id: number): void {
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) selectedIds.value.splice(index, 1)
  else selectedIds.value.push(id)
}

async function enroll(): Promise<void> {
  if (!enrollCohort.value || selectedIds.value.length === 0) return
  modalError.value = ''
  busy.value = true
  try {
    await api.post(`/cohorts/${enrollCohort.value.id}/enrollments`, { studentIds: selectedIds.value })
    showEnroll.value = false
    flash.value = `${selectedIds.value.length} student(s) enrolled.`
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function removeStudent(student: CohortStudent): Promise<void> {
  if (!window.confirm(`Remove ${student.name} from this cohort?`)) return
  try {
    await api.del(`/enrollments/${student.enrollmentId}`)
    roster.value = roster.value.filter((row) => row.id !== student.id)
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  }
}

async function removeCohort(cohort: Cohort): Promise<void> {
  if (!window.confirm(`Delete cohort “${cohort.name}”?`)) return
  try {
    await api.del(`/cohorts/${cohort.id}`)
    flash.value = 'Cohort deleted.'
    await load()
  } catch (cause) {
    flash.value = formatApiError(cause)
  }
}

onMounted(async () => {
  await Promise.all([load(), loadPrograms()])
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Cohorts</h1>
        <p class="subtitle">Batches of students enrolled into programs.</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button" :disabled="programs.length === 0" @click="openCreate()">
          + New cohort
        </button>
      </div>
    </div>

    <div v-if="flash" class="alert alert-info" role="status">
      {{ flash }}
      <button type="button" style="float: right; background: none; border: none; cursor: pointer" @click="flash = ''">✕</button>
    </div>

    <div class="toolbar">
      <select v-model="programFilter" aria-label="Filter by program" @change="page = 1">
        <option value="">All programs</option>
        <option v-for="program in programs" :key="program.id" :value="String(program.id)">{{ program.title }}</option>
      </select>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load cohorts" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading cohorts…" />

    <template v-else>
      <EmptyState
        v-if="cohorts.length === 0"
        icon="⊞"
        title="No cohorts yet"
        message="Create a cohort inside a program, then enroll students into it."
      />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Cohort</th>
              <th>Program</th>
              <th>Schedule</th>
              <th class="num">Students</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cohort in cohorts" :key="cohort.id">
              <td><strong>{{ cohort.name }}</strong></td>
              <td>
                <router-link :to="`/app/programs/${cohort.programId}`">{{ cohort.programTitle }}</router-link>
              </td>
              <td class="nowrap small">
                {{ cohort.startDate ? formatDate(cohort.startDate) : '—' }}
                <template v-if="cohort.endDate"> → {{ formatDate(cohort.endDate) }}</template>
              </td>
              <td class="num">{{ cohort.studentCount }}</td>
              <td class="text-right nowrap">
                <button class="btn btn-sm" type="button" @click="openRoster(cohort)">Students</button>
                <button class="btn btn-sm" type="button" style="margin-left: 6px" @click="openEnroll(cohort)">Enroll</button>
                <button
                  v-if="cohort.studentCount === 0"
                  class="btn btn-sm btn-ghost"
                  type="button"
                  style="margin-left: 6px"
                  @click="removeCohort(cohort)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>

    <!-- create -->
    <ModalDialog v-if="showCreate" title="Create cohort" @close="showCreate = false">
      <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
      <form @submit.prevent="createCohort()">
        <div class="field">
          <label for="k-program">Program</label>
          <select id="k-program" v-model="createForm.programId" required>
            <option v-for="program in programs" :key="program.id" :value="String(program.id)">{{ program.title }}</option>
          </select>
        </div>
        <div class="field">
          <label for="k-name">Cohort name</label>
          <input id="k-name" v-model="createForm.name" type="text" minlength="2" maxlength="100" required placeholder="e.g. Batch 02" />
        </div>
        <div class="field">
          <label for="k-start">Start date</label>
          <input id="k-start" v-model="createForm.startDate" type="date" />
        </div>
        <div class="field">
          <label for="k-end">End date</label>
          <input id="k-end" v-model="createForm.endDate" type="date" />
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">Create cohort</button>
        </div>
      </form>
    </ModalDialog>

    <!-- roster -->
    <ModalDialog
      v-if="showRoster && rosterCohort"
      :title="`${rosterCohort.name} — students`"
      large
      @close="showRoster = false"
    >
      <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
      <LoadingBlock v-if="rosterLoading" label="Loading students…" />
      <EmptyState v-else-if="roster.length === 0" icon="☺" title="No students in this cohort" message="Use Enroll to add them." />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Enrolled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="student in roster" :key="student.enrollmentId">
              <td>
                <strong>{{ student.name }}</strong>
                <div class="small muted">{{ student.email }}</div>
              </td>
              <td class="nowrap">{{ formatDate(student.enrolledAt) }}</td>
              <td class="text-right">
                <button class="btn btn-sm btn-ghost" type="button" @click="removeStudent(student)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #actions>
        <button class="btn" type="button" @click="showRoster = false">Close</button>
      </template>
    </ModalDialog>

    <!-- enroll -->
    <ModalDialog
      v-if="showEnroll && enrollCohort"
      :title="`Enroll into ${enrollCohort.name}`"
      large
      @close="showEnroll = false"
    >
      <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
      <div class="field">
        <label for="en-search">Search students</label>
        <input id="en-search" v-model="studentSearch" type="search" placeholder="Name or email…" />
      </div>
      <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px">
        <EmptyState v-if="availableStudents.length === 0" title="No students to enroll" message="All active students may already be enrolled." />
        <template v-else>
          <label
            v-for="student in availableStudents.filter((s) => !studentSearch || s.name.toLowerCase().includes(studentSearch.toLowerCase()) || s.email.toLowerCase().includes(studentSearch.toLowerCase()))"
            :key="student.id"
            class="checkbox-row"
            style="margin: 0; padding: 9px 13px; border-bottom: 1px solid var(--border)"
          >
            <input type="checkbox" :checked="selectedIds.includes(student.id)" @change="toggle(student.id)" />
            <span>{{ student.name }} <span class="muted small">({{ student.email }})</span></span>
          </label>
        </template>
      </div>
      <p class="small muted" style="margin-top: 10px">{{ selectedIds.length }} selected</p>
      <template #actions>
        <button class="btn" type="button" @click="showEnroll = false">Cancel</button>
        <button class="btn btn-primary" type="button" :disabled="busy || selectedIds.length === 0" @click="enroll()">
          <span v-if="busy" class="spinner spinner-sm" />
          Enroll {{ selectedIds.length || '' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
