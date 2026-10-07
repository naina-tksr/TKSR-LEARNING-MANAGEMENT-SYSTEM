<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { Paginated } from '../types'
import { formatDateTime, formatRelative } from '../format'
import StatusBadge from '../components/StatusBadge.vue'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

interface MySubmissionRow {
  id: number
  status: 'submitted' | 'graded'
  score: number | null
  isLate: boolean
  attempts: number
  submittedAt: string
  gradedAt: string | null
  feedback: string | null
  assignmentId: number
  assignmentTitle: string
  maxMarks: number
  dueAt: string | null
  programId: number
  programTitle: string
}

const rows = ref<MySubmissionRow[]>([])
const meta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const expanded = ref<number | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await api.get<Paginated<MySubmissionRow>>(`/my/submissions?page=${page.value}&limit=15`)
    rows.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

watch(page, () => void load())
onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>My submissions</h1>
        <p class="subtitle">Everything you have submitted, with released grades and trainer feedback.</p>
      </div>
      <div class="actions">
        <router-link class="btn" to="/app/assignments">Assignments →</router-link>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load submissions" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading your submissions…" />

    <template v-else>
      <EmptyState
        v-if="rows.length === 0"
        icon="↧"
        title="No submissions yet"
        message="Open an assignment and submit your work — it will show up here."
      >
        <router-link class="btn btn-primary" to="/app/assignments">Browse assignments</router-link>
      </EmptyState>

      <div v-else class="list-rows card">
        <div v-for="row in rows" :key="row.id" style="border-bottom: 1px solid var(--border)">
          <div class="list-row" style="border-bottom: none">
            <div class="grow">
              <router-link class="title" :to="`/app/assignments/${row.assignmentId}`">{{ row.assignmentTitle }}</router-link>
              <div class="sub">
                {{ row.programTitle }} · submitted {{ formatDateTime(row.submittedAt) }}
                <span v-if="row.attempts > 1"> · attempt {{ row.attempts }}</span>
                <span v-if="row.isLate" class="badge badge-warning" style="margin-left: 5px">late</span>
              </div>
            </div>

            <span class="right">
              <StatusBadge :status="row.status" />
              <div v-if="row.status === 'graded'" style="margin-top: 5px">
                <strong>{{ row.score }}</strong
                >/{{ row.maxMarks }}
              </div>
              <div v-else class="small" style="margin-top: 5px">awaiting grade</div>
            </span>

            <button
              v-if="row.feedback"
              class="btn btn-sm"
              type="button"
              @click="expanded = expanded === row.id ? null : row.id"
            >
              {{ expanded === row.id ? 'Hide feedback' : 'Feedback' }}
            </button>
          </div>

          <div
            v-if="expanded === row.id && row.feedback"
            class="alert alert-success"
            style="margin: 0 0 12px"
          >
            <strong>Trainer feedback</strong>
            <div style="white-space: pre-wrap; margin-top: 4px">{{ row.feedback }}</div>
            <div class="small" style="margin-top: 6px; opacity: 0.8">
              Released {{ row.gradedAt ? formatDateTime(row.gradedAt) : formatRelative(row.gradedAt) }}
            </div>
          </div>
        </div>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>
  </div>
</template>
