<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import type { TrainerDashboard } from '../types'
import { formatRelative, isPast } from '../format'
import StatCard from '../components/StatCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const data = ref<TrainerDashboard | null>(null)
const error = ref<unknown>(null)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<TrainerDashboard>('/dashboard')
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

onMounted(load)

function gradeRate(submissionCount: number, gradedCount: number): number {
  if (submissionCount === 0) return 0
  return Math.round((gradedCount / submissionCount) * 100)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Trainer dashboard</h1>
        <p class="subtitle">Your programs, students and pending reviews at a glance.</p>
      </div>
      <div class="actions">
        <router-link class="btn" to="/app/programs">Manage programs</router-link>
        <router-link class="btn btn-primary" to="/app/grading">Open grading queue</router-link>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load your dashboard" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading your dashboard…" />

    <template v-else-if="data">
      <div class="grid grid-stats mb-16">
        <StatCard label="My programs" :value="data.stats.programs" icon="▤" />
        <StatCard label="Students" :value="data.stats.students" icon="☺" />
        <StatCard label="Pending submissions" :value="data.stats.pendingSubmissions" icon="◔"
          :sub="data.stats.pendingSubmissions > 0 ? 'Waiting for your grade' : 'Queue is clear'" />
        <StatCard label="Assignments" :value="data.stats.assignments" icon="✎" />
      </div>

      <div class="grid grid-2">
        <section class="card">
          <h3 class="card-title">My programs</h3>
          <div v-if="data.programs.length === 0">
            <EmptyState title="No programs assigned" message="An admin can assign a program to you from the Programs page." />
          </div>
          <div v-else class="list-rows">
            <div v-for="program in data.programs" :key="program.id" class="list-row">
              <div class="grow">
                <router-link class="title" :to="`/app/programs/${program.id}`">{{ program.title }}</router-link>
                <div class="sub">
                  {{ program.moduleCount }} modules · {{ program.studentCount }} students · {{ program.level }}
                </div>
              </div>
              <StatusBadge :status="program.status" />
            </div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">
            Assignments
            <router-link class="sub" to="/app/assignments">View all →</router-link>
          </h3>
          <div v-if="data.assignments.length === 0">
            <EmptyState icon="✎" title="No assignments yet" message="Create one from a program page." />
          </div>
          <div v-else class="list-rows">
            <div v-for="assignment in data.assignments" :key="assignment.id" class="list-row">
              <div class="grow">
                <router-link class="title" :to="`/app/assignments/${assignment.id}`">{{ assignment.title }}</router-link>
                <div class="sub">
                  {{ assignment.programTitle }} · due {{ assignment.dueAt ? assignment.dueAt.slice(0, 10) : '—' }}
                  <span v-if="isPast(assignment.dueAt)" class="badge badge-danger" style="margin-left: 4px">past due</span>
                </div>
                <div style="margin-top: 6px">
                  <ProgressBar :percent="gradeRate(assignment.submissionCount, assignment.gradedCount)" />
                </div>
              </div>
              <span class="right">
                {{ assignment.gradedCount }}/{{ assignment.submissionCount }}
                <div class="small">graded</div>
              </span>
            </div>
          </div>
        </section>

        <section class="card" style="grid-column: 1 / -1">
          <h3 class="card-title">
            Recent submissions
            <router-link class="sub" to="/app/grading">Grading queue →</router-link>
          </h3>
          <div v-if="data.recentSubmissions.length === 0">
            <EmptyState icon="↧" title="No submissions yet" message="Student work will land in your grading queue." />
          </div>
          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Assignment</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th class="num">Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="submission in data.recentSubmissions" :key="submission.id">
                  <td>{{ submission.studentName }}</td>
                  <td>{{ submission.assignmentTitle }}</td>
                  <td class="nowrap">{{ formatRelative(submission.submittedAt) }}</td>
                  <td>
                    <StatusBadge :status="submission.status" />
                    <span v-if="submission.isLate" class="badge badge-warning" style="margin-left: 5px">late</span>
                  </td>
                  <td class="num">
                    {{ submission.score ?? '—' }}
                  </td>
                  <td class="text-right">
                    <router-link class="btn btn-sm" :to="`/app/grading/${submission.id}`">
                      {{ submission.status === 'graded' ? 'Review' : 'Grade' }}
                    </router-link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
