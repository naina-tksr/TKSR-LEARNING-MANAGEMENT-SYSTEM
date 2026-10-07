<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { Paginated, StudentAssignmentRow } from '../types'
import { session } from '../session'
import { formatDate, isPast } from '../format'
import StatusBadge from '../components/StatusBadge.vue'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

type StatusFilter = 'all' | 'pending' | 'submitted' | 'graded'

const rows = ref<StudentAssignmentRow[]>([])
const meta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const filter = ref<StatusFilter>('all')

const isStudent = computed(() => session.user?.role === 'student')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    if (isStudent.value) {
      const params = new URLSearchParams({ page: String(page.value), limit: '15', status: filter.value })
      const result = await api.get<Paginated<StudentAssignmentRow>>(`/my/assignments?${params}`)
      rows.value = result.data
      meta.value = result.meta
    } else {
      // Trainers/admins manage assignments inside each program; the cross-program
      // view that matters for them is the grading queue.
      rows.value = []
      meta.value = { page: 1, limit: 15, total: 0, totalPages: 0 }
    }
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

watch([page, filter], () => void load())
onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Assignments</h1>
        <p class="subtitle">
          {{ isStudent ? 'Everything due across your programs.' : 'Open the grading queue to review submissions.' }}
        </p>
      </div>
      <div class="actions">
        <router-link v-if="!isStudent" class="btn btn-primary" to="/app/grading">Grading queue →</router-link>
      </div>
    </div>

    <div v-if="isStudent" class="tabs">
      <button
        v-for="option in (['all', 'pending', 'submitted', 'graded'] as StatusFilter[])"
        :key="option"
        class="tab"
        :class="{ active: filter === option }"
        type="button"
        @click="filter = option; page = 1"
      >
        {{ option === 'all' ? 'All' : option[0].toUpperCase() + option.slice(1) }}
      </button>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load assignments" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading assignments…" />

    <template v-else>
      <EmptyState
        v-if="rows.length === 0"
        icon="✎"
        title="No assignments here"
        :message="isStudent ? 'When your trainer publishes one, it will appear in this list.' : 'Nothing to show yet.'"
      />

      <div v-else class="list-rows card">
        <div v-for="assignment in rows" :key="assignment.id" class="list-row">
          <div class="grow">
            <router-link class="title" :to="`/app/assignments/${assignment.id}`">{{ assignment.title }}</router-link>
            <div class="sub">
              {{ assignment.programTitle }} · {{ assignment.maxMarks }} marks
              <template v-if="assignment.dueAt"> · due {{ formatDate(assignment.dueAt) }}</template>
            </div>
          </div>

          <span v-if="isStudent" class="right">
            <span
              v-if="assignment.submission"
              class="badge"
              :class="assignment.submission.status === 'graded' ? 'badge-success' : 'badge-info'"
            >
              {{ assignment.submission.status }}
            </span>
            <span v-else class="badge badge-warning">not submitted</span>
            <div v-if="assignment.submission?.score !== null && assignment.submission?.score !== undefined" class="small" style="margin-top: 4px">
              <strong>{{ assignment.submission.score }}</strong>/{{ assignment.maxMarks }}
            </div>
            <div v-else-if="isPast(assignment.dueAt) && !assignment.submission" class="small" style="color: var(--danger-text); margin-top: 4px">
              past due
            </div>
          </span>
          <span v-else class="right">
            <StatusBadge :status="assignment.status" />
          </span>
        </div>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>
  </div>
</template>
