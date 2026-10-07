<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, formatApiError } from '../api'
import type { Lesson, ProgramDetail } from '../types'
import { renderMarkdown } from '../markdown'
import { session } from '../session'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import ProgressBar from '../components/ProgressBar.vue'

const route = useRoute()
const router = useRouter()

const detail = ref<ProgramDetail | null>(null)
const loading = ref(true)
const error = ref<unknown>(null)
const busy = ref(false)
const actionError = ref('')

const programId = computed(() => Number(route.params.id))
const lessonId = computed(() => Number(route.params.lessonId))

const flatLessons = computed<{ lesson: Lesson; moduleId: number; moduleTitle: string }[]>(() => {
  if (!detail.value) return []
  return detail.value.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ lesson, moduleId: module.id, moduleTitle: module.title })),
  )
})

const current = computed(() => flatLessons.value.find((item) => item.lesson.id === lessonId.value) ?? null)
const currentIndex = computed(() => flatLessons.value.findIndex((item) => item.lesson.id === lessonId.value))
const prev = computed(() => (currentIndex.value > 0 ? flatLessons.value[currentIndex.value - 1] : null))
const next = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < flatLessons.value.length - 1
    ? flatLessons.value[currentIndex.value + 1]
    : null,
)

const isStudent = computed(() => detail.value?.access === 'student')
const html = computed(() => (current.value ? renderMarkdown(current.value.lesson.content) : ''))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    detail.value = await api.get<ProgramDetail>(`/programs/${programId.value}`)
    if (!current.value) {
      // Lesson doesn't belong to this program — bounce back to the program.
      router.replace(`/app/programs/${programId.value}`)
      return
    }
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

async function toggleComplete(): Promise<void> {
  if (!current.value) return
  busy.value = true
  actionError.value = ''
  const lesson = current.value.lesson
  try {
    if (lesson.completed) await api.del(`/my/lessons/${lesson.id}/complete`)
    else await api.post(`/my/lessons/${lesson.id}/complete`)
    await load()
  } catch (cause) {
    actionError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

watch(lessonId, () => {
  actionError.value = ''
  void load()
})

onMounted(load)
</script>

<template>
  <div>
    <ErrorBlock v-if="error" :error="error" title="Could not load the lesson" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Opening lesson…" />

    <template v-else-if="detail && current">
      <div class="breadcrumbs">
        <router-link to="/app/programs">Programs</router-link>
        <span>›</span>
        <router-link :to="`/app/programs/${detail.program.id}`">{{ detail.program.title }}</router-link>
        <span>›</span>
        <span>{{ current.moduleTitle }}</span>
        <span>›</span>
        <span>{{ current.lesson.title }}</span>
      </div>

      <div class="page-head">
        <div>
          <h1>{{ current.lesson.title }}</h1>
          <p class="subtitle">{{ current.moduleTitle }}</p>
        </div>
        <div v-if="detail.progress" style="min-width: 220px">
          <ProgressBar :percent="detail.progress.percent" :success="detail.progress.percent === 100" />
          <div class="small muted text-right">{{ detail.progress.completedLessons }}/{{ detail.progress.totalLessons }} lessons</div>
        </div>
      </div>

      <div v-if="actionError" class="error-banner"><span>{{ actionError }}</span></div>

      <div class="lesson-layout">
        <aside class="lesson-outline" aria-label="Course outline">
          <div v-for="module in detail.modules" :key="module.id" class="outline-module">
            <div class="m-title">{{ module.title }}</div>
            <router-link
              v-for="lesson in module.lessons"
              :key="lesson.id"
              class="outline-lesson"
              :class="{ active: lesson.id === current.lesson.id }"
              :to="`/app/programs/${detail.program.id}/modules/${module.id}/lessons/${lesson.id}`"
            >
              <span class="check" :class="{ done: lesson.completed }">{{ lesson.completed ? '✓' : '○' }}</span>
              <span>{{ lesson.title }}</span>
            </router-link>
          </div>
        </aside>

        <article class="lesson-body">
          <div class="lesson-meta">
            <span>⏱ {{ current.lesson.durationMinutes }} min</span>
            <span>▤ {{ current.moduleTitle }}</span>
            <span v-if="current.lesson.completed" style="color: var(--success); font-weight: 600">✓ Completed</span>
          </div>

          <div v-if="current.lesson.content" class="lesson-content" v-html="html" />
          <div v-else class="muted">This lesson has no content yet.</div>

          <div class="lesson-actions">
            <router-link
              v-if="prev"
              class="btn"
              :to="`/app/programs/${detail.program.id}/modules/${prev.moduleId}/lessons/${prev.lesson.id}`"
            >
              ← {{ prev.lesson.title }}
            </router-link>
            <span v-else />

            <button
              v-if="isStudent && session.user"
              class="btn"
              :class="{ 'btn-primary': !current.lesson.completed }"
              type="button"
              :disabled="busy"
              @click="toggleComplete()"
            >
              <span v-if="busy" class="spinner spinner-sm" />
              {{ current.lesson.completed ? 'Mark as not done' : 'Mark complete ✓' }}
            </button>

            <router-link
              v-if="next"
              class="btn btn-primary"
              :to="`/app/programs/${detail.program.id}/modules/${next.moduleId}/lessons/${next.lesson.id}`"
            >
              {{ next.lesson.title }} →
            </router-link>
            <span v-else-if="current.lesson.completed" class="small" style="color: var(--success)">🎓 Program finished — review any time.</span>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
