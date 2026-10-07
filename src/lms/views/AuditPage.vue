<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { AuditEntry, Paginated } from '../types'
import { formatDateTime } from '../format'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const entries = ref<AuditEntry[]>([])
const meta = ref({ page: 1, limit: 25, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const actionFilter = ref('')
const actions = ref<string[]>([])

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '25' })
    if (actionFilter.value) params.set('action', actionFilter.value)
    const result = await api.get<Paginated<AuditEntry>>(`/audit?${params}`)
    entries.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

watch([page, actionFilter], () => void load())

onMounted(async () => {
  await load()
  try {
    const result = await api.get<{ actions: string[] }>('/audit/actions')
    actions.value = result.actions
  } catch {
    /* filter stays plain */
  }
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Audit log</h1>
        <p class="subtitle">Every important action recorded by the platform — who did what, and when.</p>
      </div>
    </div>

    <div class="toolbar">
      <select v-model="actionFilter" aria-label="Filter by action" @change="page = 1">
        <option value="">All actions</option>
        <option v-for="action in actions" :key="action" :value="action">{{ action }}</option>
      </select>
      <button class="btn btn-sm" type="button" @click="load()">Refresh</button>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load the audit log" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading audit entries…" />

    <template v-else>
      <EmptyState v-if="entries.length === 0" icon="≡" title="No audit entries" message="Nothing recorded for this filter." />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id">
              <td class="nowrap small">{{ formatDateTime(entry.createdAt) }}</td>
              <td>{{ entry.userName ?? 'system' }}</td>
              <td><code>{{ entry.action }}</code></td>
              <td class="small">
                {{ entry.entityType ?? '—' }}
                <template v-if="entry.entityId !== null"> #{{ entry.entityId }}</template>
              </td>
              <td class="small muted nowrap">{{ entry.ip ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>
  </div>
</template>
