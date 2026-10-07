<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import type { AdminDashboard } from '../types'
import { formatRelative } from '../format'
import StatCard from '../components/StatCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const data = ref<AdminDashboard | null>(null)
const error = ref<unknown>(null)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<AdminDashboard>('/dashboard')
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

onMounted(load)

function actionLabel(action: string): string {
  return action.replace(/\./g, ' › ')
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Admin dashboard</h1>
        <p class="subtitle">Users, programs and enrollment health across the academy.</p>
      </div>
      <div class="actions">
        <router-link class="btn" to="/app/users">Manage users</router-link>
        <router-link class="btn btn-primary" to="/app/programs">Programs</router-link>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load your dashboard" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading your dashboard…" />

    <template v-else-if="data">
      <div class="grid grid-stats mb-16">
        <StatCard label="Total users" :value="data.stats.users.total" icon="☺"
          :sub="`${data.stats.users.trainers} trainers · ${data.stats.users.students} students`" />
        <StatCard label="Programs" :value="data.stats.programs.total" icon="▤"
          :sub="`${data.stats.programs.published} published · ${data.stats.programs.draft} drafts`" />
        <StatCard label="Active enrollments" :value="data.stats.enrollments.total" icon="⊞"
          :sub="`${data.stats.enrollments.cohorts} cohorts · ${data.stats.enrollments.students} students`" />
        <StatCard label="Submissions" :value="data.stats.submissions.pending + data.stats.submissions.graded" icon="✎"
          :sub="`${data.stats.submissions.pending} pending · ${data.stats.submissions.graded} graded`" />
      </div>

      <div class="grid grid-2">
        <section class="card">
          <h3 class="card-title">
            Recently joined
            <router-link class="sub" to="/app/users">All users →</router-link>
          </h3>
          <div v-if="data.recentUsers.length === 0">
            <EmptyState title="No users yet" />
          </div>
          <div v-else class="list-rows">
            <div v-for="user in data.recentUsers" :key="user.id" class="list-row">
              <span class="avatar">{{ user.name.slice(0, 1).toUpperCase() }}</span>
              <div class="grow">
                <div class="title">{{ user.name }}</div>
                <div class="sub">{{ user.email }}</div>
              </div>
              <span class="right">
                <span class="badge badge-primary">{{ user.role }}</span>
                <div class="small" style="margin-top: 4px">{{ formatRelative(user.createdAt) }}</div>
              </span>
            </div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">
            Recent activity
            <router-link class="sub" to="/app/audit">Audit log →</router-link>
          </h3>
          <div v-if="data.recentActivity.length === 0">
            <EmptyState title="No activity recorded" />
          </div>
          <div v-else class="list-rows">
            <div v-for="entry in data.recentActivity" :key="entry.id" class="list-row">
              <div class="grow">
                <div class="title" style="font-size: 0.86rem">{{ actionLabel(entry.action) }}</div>
                <div class="sub">{{ entry.userName ?? 'system' }} · {{ entry.entityType }}</div>
              </div>
              <span class="right">{{ formatRelative(entry.createdAt) }}</span>
            </div>
          </div>
        </section>

        <section class="card" style="grid-column: 1 / -1">
          <h3 class="card-title">System snapshot</h3>
          <div class="grid grid-3">
            <div class="kv">
              <dt>Accounts active</dt>
              <dd>{{ data.stats.users.active }}/{{ data.stats.users.total }}</dd>
              <dt>Cohorts</dt>
              <dd>{{ data.stats.enrollments.cohorts }}</dd>
            </div>
            <div class="kv">
              <dt>Draft programs</dt>
              <dd>{{ data.stats.programs.draft }}</dd>
              <dt>Published programs</dt>
              <dd>{{ data.stats.programs.published }}</dd>
            </div>
            <div class="kv">
              <dt>Grading backlog</dt>
              <dd>
                <StatusBadge :status="data.stats.submissions.pending > 0 ? 'pending' : 'graded'" />
                {{ data.stats.submissions.pending }} waiting
              </dd>
              <dt>Graded so far</dt>
              <dd>{{ data.stats.submissions.graded }}</dd>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
