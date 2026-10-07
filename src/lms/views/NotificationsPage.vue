<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'
import type { Notification, Paginated } from '../types'
import { formatRelative } from '../format'
import PaginationBar from '../components/PaginationBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const items = ref<Notification[]>([])
const meta = ref({ page: 1, limit: 20, total: 0, totalPages: 0 })
const unread = ref(0)
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const unreadOnly = ref(false)

const icons: Record<string, string> = {
  grade: '✓',
  assignment: '✎',
  enrollment: '☺',
  program: '▤',
  system: '◆',
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '20' })
    if (unreadOnly.value) params.set('unread', '1')
    const result = await api.get<Paginated<Notification> & { unread: number }>(`/notifications?${params}`)
    items.value = result.data
    meta.value = result.meta
    unread.value = result.unread
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

watch([page, unreadOnly], () => void load())

async function markRead(item: Notification): Promise<void> {
  if (item.readAt) return
  try {
    const result = await api.post<{ unread: number }>(`/notifications/${item.id}/read`)
    item.readAt = new Date().toISOString()
    unread.value = result.unread
  } catch {
    /* non-critical */
  }
}

async function markAllRead(): Promise<void> {
  try {
    const result = await api.post<{ updated: number; unread: number }>('/notifications/read-all')
    unread.value = result.unread
    for (const item of items.value) if (!item.readAt) item.readAt = new Date().toISOString()
  } catch {
    /* non-critical */
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Notifications</h1>
        <p class="subtitle">{{ unread > 0 ? `${unread} unread.` : 'You are all caught up.' }}</p>
      </div>
      <div class="actions">
        <label class="checkbox-row" style="margin: 0">
          <input v-model="unreadOnly" type="checkbox" @change="page = 1" />
          Unread only
        </label>
        <button class="btn" type="button" :disabled="unread === 0" @click="markAllRead()">Mark all read</button>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load notifications" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading notifications…" />

    <template v-else>
      <div class="card">
        <EmptyState
          v-if="items.length === 0"
          icon="◔"
          title="No notifications"
          :message="unreadOnly ? 'No unread notifications left.' : 'Grades, enrollment and program updates show up here.'"
        />
        <template v-else>
          <div
            v-for="item in items"
            :key="item.id"
            class="notification-row"
            :class="{ unread: !item.readAt }"
            @click="markRead(item)"
          >
            <span class="n-icon">{{ icons[item.type] ?? '◆' }}</span>
            <div class="grow" style="flex: 1">
              <div class="n-title">
                {{ item.title }}
                <span v-if="!item.readAt" class="badge badge-primary" style="margin-left: 6px">new</span>
              </div>
              <div class="n-body">{{ item.body }}</div>
              <router-link v-if="item.link" :to="item.link" class="small" @click.stop="markRead(item)">Open →</router-link>
            </div>
            <span class="n-time nowrap">{{ formatRelative(item.createdAt) }}</span>
          </div>
        </template>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>
  </div>
</template>
