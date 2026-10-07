<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { Paginated } from '../types'
import { formatRelative } from '../format'
import StatusBadge from '../components/StatusBadge.vue'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

interface QueueRow {
  id: number
  status: 'submitted' | 'graded'
  score: number | null
  isLate: boolean
  attempts: number
  submittedAt: string
  gradedAt: string | null
  studentId: number
  studentName: string
  assignmentId: number
  assignmentTitle: string
  maxMarks: number
  dueAt: string | null
  programId: number
  programTitle: string
  aiEvaluationCount: number
}

const rows = ref<QueueRow[]>([])
const meta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const statusFilter = ref<'' | 'submitted' | 'graded'>('')

const pendingCount = computed(() => rows.value.filter((row) => row.status === 'submitted').length)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '15' })
    if (statusFilter.value) params.set('status', statusFilter.value)
    const result = await api.get<Paginated<QueueRow>>(`/submissions?${params}`)
    rows.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

watch([page, statusFilter], () => void load())
onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Grading queue</h1>
        <p class="subtitle">Review submissions, ask the AI assistant for a suggestion, then release the grade yourself.</p>
      </div>
    </div>

    <div class="toolbar">
      <select v-model="statusFilter" aria-label="Filter by status" @change="page = 1">
        <option value="">Everything</option>
        <option value="submitted">Awaiting grade</option>
        <option value="graded">Graded</option>
      </select>
      <span v-if="pendingCount > 0 && statusFilter === ''" class="small muted">{{ pendingCount }} waiting on this page</span>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load the queue" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading submissions…" />

    <template v-else>
      <EmptyState
        v-if="rows.length === 0"
        icon="✓"
        title="Nothing in the queue"
        :message="statusFilter ? 'No submissions match this filter.' : 'When students submit work it lands here.'"
      />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Assignment</th>
              <th>Program</th>
              <th>Submitted</th>
              <th>Status</th>
              <th class="num">Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <strong>{{ row.studentName }}</strong>
                <div v-if="row.attempts > 1" class="small muted">attempt {{ row.attempts }}</div>
              </td>
              <td>
                <router-link :to="`/app/assignments/${row.assignmentId}`">{{ row.assignmentTitle }}</router-link>
                <div class="small muted">out of {{ row.maxMarks }}</div>
              </td>
              <td class="small">{{ row.programTitle }}</td>
              <td class="nowrap small">{{ formatRelative(row.submittedAt) }}</td>
              <td>
                <StatusBadge :status="row.status" />
                <span v-if="row.isLate" class="badge badge-warning" style="margin-left: 5px">late</span>
                <span v-if="row.aiEvaluationCount > 0" class="badge badge-primary" style="margin-left: 5px">✦ ai</span>
              </td>
              <td class="num">{{ row.score ?? '—' }}</td>
              <td class="text-right">
                <router-link class="btn btn-sm btn-primary" :to="`/app/grading/${row.id}`">
                  {{ row.status === 'graded' ? 'Review' : 'Grade' }}
                </router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>
  </div>
</template>
