<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, formatApiError } from '../api'
import type { Paginated, ProgramListItem, User } from '../types'
import { session } from '../session'
import ModalDialog from '../components/ModalDialog.vue'
import PaginationBar from '../components/PaginationBar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const programs = ref<ProgramListItem[]>([])
const meta = ref({ page: 1, limit: 12, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const busy = ref(false)

const search = ref('')
const statusFilter = ref('')
const levelFilter = ref('')
const page = ref(1)

const trainers = ref<User[]>([])
const showCreate = ref(false)
const createError = ref('')
const form = ref({ title: '', description: '', level: 'beginner', trainerId: '' })

const isAdmin = computed(() => session.user?.role === 'admin')
const isStudent = computed(() => session.user?.role === 'student')

let searchTimer: number | undefined

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '12' })
    if (search.value.trim()) params.set('q', search.value.trim())
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (levelFilter.value) params.set('level', levelFilter.value)
    const result = await api.get<Paginated<ProgramListItem>>(`/programs?${params}`)
    programs.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

function onSearch(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
}

watch([statusFilter, levelFilter], () => {
  page.value = 1
  void load()
})

watch(page, () => void load())

async function openCreate(): Promise<void> {
  createError.value = ''
  form.value = { title: '', description: '', level: 'beginner', trainerId: '' }
  showCreate.value = true
  if (trainers.value.length === 0) {
    try {
      const result = await api.get<Paginated<User>>('/users?role=trainer&limit=100')
      trainers.value = result.data
    } catch {
      /* trainer dropdown just stays empty */
    }
  }
}

async function createProgram(): Promise<void> {
  createError.value = ''
  busy.value = true
  try {
    await api.post('/programs', {
      title: form.value.title.trim(),
      description: form.value.description.trim(),
      level: form.value.level,
      trainerId: form.value.trainerId ? Number(form.value.trainerId) : null,
    })
    showCreate.value = false
    page.value = 1
    await load()
  } catch (cause) {
    createError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Programs</h1>
        <p class="subtitle">
          {{ isStudent ? 'Programs you are enrolled in.' : isAdmin ? 'All programs in the academy.' : 'Programs assigned to you.' }}
        </p>
      </div>
      <div class="actions">
        <button v-if="isAdmin" class="btn btn-primary" type="button" @click="openCreate()">+ New program</button>
      </div>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search programs…"
        aria-label="Search programs"
        @input="onSearch()"
      />
      <select v-if="!isStudent" v-model="statusFilter" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="published">Published</option>
        <option value="draft">Draft</option>
      </select>
      <select v-model="levelFilter" aria-label="Filter by level">
        <option value="">All levels</option>
        <option value="beginner">Beginner</option>
        <option value="intermediate">Intermediate</option>
        <option value="advanced">Advanced</option>
      </select>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load programs" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading programs…" />

    <template v-else>
      <EmptyState
        v-if="programs.length === 0"
        icon="▤"
        title="No programs found"
        :message="search || statusFilter || levelFilter ? 'Try clearing your filters.' : 'Nothing here yet.'"
      />

      <div v-else class="grid grid-3">
        <article v-for="program in programs" :key="program.id" class="program-card">
          <div class="flex-between">
            <h3><router-link :to="`/app/programs/${program.id}`">{{ program.title }}</router-link></h3>
            <StatusBadge v-if="!isStudent" :status="program.status" />
          </div>
          <p class="desc">{{ program.description || 'No description yet.' }}</p>
          <div class="meta-row">
            <span>◆ {{ program.level }}</span>
            <span>▤ {{ program.moduleCount }} modules</span>
            <span>≡ {{ program.lessonCount }} lessons</span>
            <span v-if="!isStudent">☺ {{ program.studentCount }} students</span>
            <span v-if="program.trainerName">✓ {{ program.trainerName }}</span>
          </div>
          <div v-if="isStudent && program.percent !== undefined" class="foot">
            <ProgressBar :percent="program.percent" />
          </div>
          <div v-else class="foot">
            <span class="small muted">Updated {{ program.updatedAt.slice(0, 10) }}</span>
            <router-link class="btn btn-sm" :to="`/app/programs/${program.id}`">Open →</router-link>
          </div>
        </article>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>

    <ModalDialog v-if="showCreate" title="Create program" @close="showCreate = false">
      <div v-if="createError" class="error-banner"><span>{{ createError }}</span></div>
      <form @submit.prevent="createProgram()">
        <div class="field">
          <label for="p-title">Title</label>
          <input id="p-title" v-model="form.title" type="text" minlength="3" maxlength="150" required placeholder="e.g. Applied AI Engineering" />
        </div>
        <div class="field">
          <label for="p-desc">Description</label>
          <textarea id="p-desc" v-model="form.description" maxlength="4000" rows="3" placeholder="What is this program about?" />
        </div>
        <div class="field">
          <label for="p-level">Level</label>
          <select id="p-level" v-model="form.level">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <div class="field">
          <label for="p-trainer">Trainer</label>
          <select id="p-trainer" v-model="form.trainerId">
            <option value="">— Unassigned —</option>
            <option v-for="trainer in trainers" :key="trainer.id" :value="String(trainer.id)">{{ trainer.name }}</option>
          </select>
          <span class="hint">You can assign or change the trainer later.</span>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">
            <span v-if="busy" class="spinner spinner-sm" />
            Create program
          </button>
        </div>
      </form>
    </ModalDialog>
  </div>
</template>
