<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { liveClassApi, formatApiError } from '../api'
import type { LiveClass, CreateLiveClassInput, LiveClassStatus } from '../types'
import { formatDate, formatRelative } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const programId = computed(() => Number(route.params.id))

const classes = ref<LiveClass[]>([])
const loading = ref(true)
const error = ref<unknown>(null)

const createModal = ref(false)
const editModal = ref(false)
const editingClass = ref<LiveClass | null>(null)

const form = ref<CreateLiveClassInput & { status: LiveClassStatus }>({
  title: '',
  classDate: '',
  startTime: '',
  timezone: 'UTC',
  durationMinutes: 60,
  meetUrl: '',
  moduleId: null,
  instructions: '',
  status: 'scheduled',
})

function resetForm() {
  form.value = {
    title: '',
    classDate: '',
    startTime: '',
    timezone: 'UTC',
    durationMinutes: 60,
    meetUrl: '',
    moduleId: null,
    instructions: '',
    status: 'scheduled',
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await liveClassApi.listByProgram(programId.value)
    classes.value = res.data
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  try {
    await liveClassApi.create(programId.value, form.value)
    createModal.value = false
    resetForm()
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

function openEdit(cls: LiveClass) {
  editingClass.value = cls
  const formData = {
    title: cls.title,
    classDate: cls.classDate,
    startTime: cls.startTime,
    timezone: cls.timezone,
    durationMinutes: cls.durationMinutes,
    meetUrl: cls.meetUrl || '',
    moduleId: cls.moduleId,
    instructions: cls.instructions || '',
    status: cls.status,
  } as CreateLiveClassInput & { status: LiveClassStatus }
  form.value = formData
  editModal.value = true
}

async function handleUpdate() {
  if (!editingClass.value) return
  try {
    await liveClassApi.update(editingClass.value.id, form.value)
    editModal.value = false
    editingClass.value = null
    resetForm()
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function handlePublish(id: number) {
  if (!confirm('Publish this class? Students will be notified.')) return
  try {
    await liveClassApi.publish(id)
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function handleCancel(id: number) {
  if (!confirm('Cancel this class? Students will be notified.')) return
  try {
    await liveClassApi.cancel(id)
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function handleDelete(id: number) {
  if (!confirm('Permanently delete this class? This cannot be undone.')) return
  try {
    await liveClassApi.delete(id)
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

function statusLabel(cls: LiveClass): string {
  if (cls.status === 'cancelled') return 'cancelled'
  if (cls.status === 'draft') return 'draft'
  const now = new Date()
  const start = new Date(`${cls.classDate}T${cls.startTime}`)
  if (start > now) return 'scheduled'
  const end = new Date(start.getTime() + cls.durationMinutes * 60000)
  if (now <= end) return 'live'
  return 'completed'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Live Classes</h1>
      <p class="muted">Manage live classes for this program</p>
    </header>

    <div class="flex gap-2 mb-4">
      <button class="btn btn-primary" @click="resetForm(); createModal = true">
        + Schedule Class
      </button>
    </div>

    <LoadingBlock v-if="loading" message="Loading classes…" />
    <ErrorBlock v-else-if="error" :error="error" @retry="load" />

    <div v-else class="card">
      <table class="data-table" v-if="classes.length > 0">
        <thead>
          <tr>
            <th>Title</th>
            <th>Module</th>
            <th>Date & Time</th>
            <th>Duration</th>
            <th>Meet URL</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cls in classes" :key="cls.id">
            <td>
              <strong>{{ cls.title }}</strong>
              <br />
              <span class="muted small" v-if="cls.instructions">{{ cls.instructions }}</span>
            </td>
            <td class="muted">{{ cls.moduleTitle || '—' }}</td>
            <td>
              <div>{{ formatDate(cls.classDate) }} {{ cls.startTime }} ({{ cls.timezone }})</div>
              <div class="muted small">{{ formatRelative(cls.classDate + 'T' + cls.startTime) }}</div>
            </td>
            <td>{{ cls.durationMinutes }} min</td>
            <td>
              <a v-if="cls.meetUrl" :href="cls.meetUrl" target="_blank" class="btn btn-ghost btn-sm">
                Open Meet
              </a>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <StatusBadge :status="statusLabel(cls)" />
            </td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn-ghost btn-sm" @click="openEdit(cls)">Edit</button>
                <button v-if="cls.status === 'draft'" class="btn btn-primary btn-sm" @click="handlePublish(cls.id)">Publish</button>
                <button v-if="cls.status === 'scheduled'" class="btn btn-warning btn-sm" @click="handleCancel(cls.id)">Cancel</button>
                <button v-if="cls.status === 'cancelled' || cls.status === 'draft'" class="btn btn-danger btn-sm" @click="handleDelete(cls.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <EmptyState v-else icon="◉" title="No live classes" description="Create your first live class for this program." />
    </div>

    <!-- Create Modal -->
    <ModalDialog v-model:open="createModal" title="Schedule Live Class" size="lg">
      <template #default>
        <form @submit.prevent="handleCreate" class="form-grid">
          <div class="field">
            <label>Title *</label>
            <input v-model="form.title" type="text" required placeholder="e.g. Day 1: Introduction to AI" />
          </div>
          <div class="field">
            <label>Module</label>
            <select v-model="form.moduleId" class="select">
              <option value="">No module (program-wide)</option>
            </select>
          </div>
          <div class="field">
            <label>Date *</label>
            <input v-model="form.classDate" type="date" required />
          </div>
          <div class="field">
            <label>Start Time *</label>
            <input v-model="form.startTime" type="time" required />
          </div>
          <div class="field">
            <label>Timezone *</label>
            <select v-model="form.timezone" class="select" required>
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Europe/Paris">Paris (CET/CEST)</option>
              <option value="Asia/Kolkata">India (IST)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
            </select>
          </div>
          <div class="field">
            <label>Duration (minutes) *</label>
            <input v-model.number="form.durationMinutes" type="number" min="15" max="480" required />
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Google Meet URL *</label>
            <input v-model="form.meetUrl" type="url" required placeholder="https://meet.google.com/abc-defg-hij" />
            <p class="small muted">Must be a valid Google Meet link (meet.google.com/...)</p>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Instructions (optional)</label>
            <textarea v-model="form.instructions" rows="3" placeholder="Any preparation or joining instructions for students" />
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Initial Status</label>
            <select v-model="form.status" class="select">
              <option value="draft">Draft (hidden from students)</option>
              <option value="scheduled">Scheduled (visible to students)</option>
            </select>
          </div>
          <div class="flex gap-2" style="grid-column: 1 / -1; margin-top: 0.5rem;">
            <button type="button" class="btn btn-ghost" @click="createModal = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Create Class</button>
          </div>
        </form>
      </template>
    </ModalDialog>

    <!-- Edit Modal -->
    <ModalDialog v-model:open="editModal" title="Edit Live Class" size="lg">
      <template #default>
        <form @submit.prevent="handleUpdate" class="form-grid">
          <div class="field">
            <label>Title *</label>
            <input v-model="form.title" type="text" required />
          </div>
          <div class="field">
            <label>Module</label>
            <select v-model="form.moduleId" class="select">
              <option value="">No module (program-wide)</option>
            </select>
          </div>
          <div class="field">
            <label>Date *</label>
            <input v-model="form.classDate" type="date" required />
          </div>
          <div class="field">
            <label>Start Time *</label>
            <input v-model="form.startTime" type="time" required />
          </div>
          <div class="field">
            <label>Timezone *</label>
            <select v-model="form.timezone" class="select" required>
              <option value="UTC">UTC</option>
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Europe/Paris">Paris (CET/CEST)</option>
              <option value="Asia/Kolkata">India (IST)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
            </select>
          </div>
          <div class="field">
            <label>Duration (minutes) *</label>
            <input v-model.number="form.durationMinutes" type="number" min="15" max="480" required />
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Google Meet URL *</label>
            <input v-model="form.meetUrl" type="url" required />
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Instructions (optional)</label>
            <textarea v-model="form.instructions" rows="3" />
          </div>
          <div class="field">
            <label>Status</label>
            <select v-model="form.status" class="select">
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div class="flex gap-2" style="grid-column: 1 / -1; margin-top: 0.5rem;">
            <button type="button" class="btn btn-ghost" @click="editModal = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field label {
  font-size: 0.875rem;
  font-weight: 500;
}
.select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
input, textarea {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.flex { display: flex; }
.gap-2 { gap: 0.5rem; }
.gap-1 { gap: 0.25rem; }
.btn-sm { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
</style>