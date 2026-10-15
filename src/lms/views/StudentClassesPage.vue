<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { liveClassApi } from '../api'
import type { LiveClass } from '../types'
import { formatDate, formatRelative } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'
import StatusBadge from '../components/StatusBadge.vue'

const classes = ref<LiveClass[]>([])
const loading = ref(true)
const error = ref<unknown>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await liveClassApi.myUpcoming()
    classes.value = res
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

function statusLabel(cls: LiveClass): string {
  if (cls.status === 'cancelled') return 'cancelled'
  if (cls.status === 'draft') return 'draft'
  const now = new Date()
  const start = new Date(`${cls.classDate}T${cls.startTime}`)
  if (start > now) return 'upcoming'
  const end = new Date(start.getTime() + cls.durationMinutes * 60000)
  if (now <= end) return 'live'
  return 'completed'
}

function joinClass(cls: LiveClass) {
  if (!cls.meetUrl) return
  window.open(cls.meetUrl, '_blank', 'noopener,noreferrer')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Live Classes</h1>
      <p class="muted">Upcoming and recent live sessions for your enrolled programs</p>
    </header>

    <LoadingBlock v-if="loading" message="Loading your classes…" />
    <ErrorBlock v-else-if="error" :error="error" @retry="load" />

    <div v-else class="card">
      <table class="data-table" v-if="classes.length > 0">
        <thead>
          <tr>
            <th>Class</th>
            <th>Program</th>
            <th>Date & Time</th>
            <th>Duration</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cls in classes" :key="cls.id">
            <td>
              <strong>{{ cls.title }}</strong>
              <br />
              <span class="muted small" v-if="cls.moduleTitle">{{ cls.moduleTitle }}</span>
              <span class="muted small" v-else>No module</span>
            </td>
            <td class="muted">{{ cls.programId }}</td>
            <td>
              <div>{{ formatDate(cls.classDate) }} · {{ cls.startTime }} ({{ cls.timezone }})</div>
              <div class="muted small">{{ formatRelative(cls.classDate + 'T' + cls.startTime) }}</div>
            </td>
            <td>{{ cls.durationMinutes }} min</td>
            <td>
              <StatusBadge :status="statusLabel(cls)" />
            </td>
            <td>
              <button
                class="btn btn-primary"
                :disabled="cls.status !== 'scheduled' || !cls.meetUrl"
                @click="joinClass(cls)"
              >
                {{ cls.status === 'scheduled' && cls.meetUrl ? 'Join Class' : 'Not available' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <EmptyState v-else icon="◉" title="No live classes" description="Your enrolled programs don't have any scheduled classes yet." />
    </div>
  </div>
</template>

<style scoped>
.data-table td {
  vertical-align: middle;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>