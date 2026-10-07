<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import type { StudentDashboard } from '../types'
import { formatDate, formatRelative } from '../format'
import StatCard from '../components/StatCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const data = ref<StudentDashboard | null>(null)
const error = ref<unknown>(null)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await api.get<StudentDashboard>('/dashboard')
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

onMounted(load)

const continueProgress = computed(() => {
  const target = data.value?.continueLearning
  if (!target) return null
  return data.value?.programs.find((program) => program.id === target.id)?.progress ?? null
})
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Welcome back 👋</h1>
        <p class="subtitle">Pick up where you left off.</p>
      </div>
      <div class="actions">
        <router-link class="btn" to="/app/programs">Browse programs</router-link>
        <router-link class="btn btn-primary" to="/app/tutor">Ask the AI Tutor</router-link>
      </div>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load your dashboard" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading your dashboard…" />

    <template v-else-if="data">
      <div class="grid grid-stats mb-16">
        <StatCard label="Enrolled programs" :value="data.stats.programs" icon="▤" />
        <StatCard label="Overall progress" :value="`${data.stats.overallProgress}%`" icon="◔"
          :sub="`${data.stats.completedLessons}/${data.stats.totalLessons} lessons completed`" />
        <StatCard label="Pending assignments" :value="data.stats.pendingAssignments" icon="✎" />
        <StatCard label="Graded submissions" :value="data.stats.gradedCount" icon="✓" />
      </div>

      <div v-if="data.continueLearning" class="card mb-16" style="border-left: 4px solid var(--primary)">
        <div class="flex-between">
          <div>
            <div class="small muted" style="text-transform: uppercase; letter-spacing: 0.07em">Continue learning</div>
            <h2 style="margin: 4px 0 2px">{{ data.continueLearning.title }}</h2>
            <div v-if="data.continueLearning.nextLesson" class="muted small">
              Next up:
              <strong>{{ data.continueLearning.nextLesson.moduleTitle }} › {{ data.continueLearning.nextLesson.lessonTitle }}</strong>
              <span v-if="data.continueLearning.nextLesson.completed">(all lessons done — review any time)</span>
            </div>
          </div>
          <router-link
            v-if="data.continueLearning.nextLesson"
            class="btn btn-primary"
            :to="`/app/programs/${data.continueLearning.id}/modules/${data.continueLearning.nextLesson.moduleId}/lessons/${data.continueLearning.nextLesson.lessonId}`"
          >
            Resume →
          </router-link>
        </div>
        <div v-if="continueProgress" style="margin-top: 14px">
          <ProgressBar :percent="continueProgress.percent" />
        </div>
      </div>

      <div class="grid grid-2">
        <section class="card">
          <h3 class="card-title">My programs</h3>
          <div v-if="data.programs.length === 0">
            <EmptyState title="No programs yet" message="Once a trainer enrolls you, your programs appear here.">
              <router-link class="btn" to="/app/programs">See programs</router-link>
            </EmptyState>
          </div>
          <div v-else class="list-rows">
            <div v-for="program in data.programs" :key="program.id" class="list-row">
              <div class="grow">
                <router-link class="title" :to="`/app/programs/${program.id}`">{{ program.title }}</router-link>
                <div class="sub">{{ program.progress.completedLessons }}/{{ program.progress.totalLessons }} lessons</div>
                <div style="margin-top: 6px"><ProgressBar :percent="program.progress.percent" /></div>
              </div>
              <span class="right">{{ program.progress.percent }}%</span>
            </div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">Pending assignments</h3>
          <div v-if="data.pendingAssignments.length === 0">
            <EmptyState icon="✓" title="All caught up" message="No open assignments right now." />
          </div>
          <div v-else class="list-rows">
            <div v-for="assignment in data.pendingAssignments" :key="assignment.id" class="list-row">
              <div class="grow">
                <router-link class="title" :to="`/app/assignments/${assignment.id}`">{{ assignment.title }}</router-link>
                <div class="sub">{{ assignment.programTitle }} · {{ assignment.maxMarks }} marks</div>
              </div>
              <span class="right">
                <span class="badge" :class="assignment.isOverdue ? 'badge-danger' : 'badge-warning'">
                  {{ assignment.isOverdue ? 'Overdue' : 'Due' }}
                </span>
                <div class="small" style="margin-top: 4px">{{ formatDate(assignment.dueAt) }}</div>
              </span>
            </div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">Recent grades</h3>
          <div v-if="data.recentGrades.length === 0">
            <EmptyState icon="✎" title="No grades yet" message="Grades appear here as soon as a trainer releases them." />
          </div>
          <div v-else class="list-rows">
            <div v-for="grade in data.recentGrades" :key="grade.id" class="list-row">
              <div class="grow">
                <router-link class="title" :to="`/app/assignments/${grade.assignmentId}`">{{ grade.assignmentTitle }}</router-link>
                <div class="sub">Graded {{ formatRelative(grade.gradedAt) }}</div>
              </div>
              <span class="right">
                <strong>{{ grade.score }}</strong
                >/{{ grade.maxMarks }}
                <span v-if="grade.isLate" class="badge badge-warning" style="margin-left: 6px">late</span>
              </span>
            </div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">Quick actions</h3>
          <div class="list-rows">
            <router-link class="list-row" to="/app/assignments" style="text-decoration: none; color: inherit">
              <span aria-hidden="true">✎</span>
              <span class="grow title">All assignments</span>
              <span class="right">→</span>
            </router-link>
            <router-link class="list-row" to="/app/my-submissions" style="text-decoration: none; color: inherit">
              <span aria-hidden="true">↧</span>
              <span class="grow title">My submissions &amp; feedback</span>
              <span class="right">→</span>
            </router-link>
            <router-link class="list-row" to="/app/tutor" style="text-decoration: none; color: inherit">
              <span aria-hidden="true">✦</span>
              <span class="grow title">AI Learning Tutor</span>
              <span class="right">→</span>
            </router-link>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
