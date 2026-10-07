<script setup lang="ts">
import { computed } from 'vue'
import { session } from '../session'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

interface NavLink {
  to: string
  label: string
  icon: string
}

const role = computed(() => session.user?.role ?? 'student')

const sections = computed<{ title: string; links: NavLink[] }[]>(() => {
  const learning: NavLink[] = [
    { to: '/app', label: 'Dashboard', icon: '◈' },
    { to: '/app/programs', label: 'Programs', icon: '▤' },
    { to: '/app/assignments', label: 'Assignments', icon: '✎' },
    { to: '/app/tutor', label: 'AI Tutor', icon: '✦' },
  ]

  if (role.value === 'student') {
    learning.push({ to: '/app/my-submissions', label: 'My submissions', icon: '↧' })
  }

  const management: NavLink[] = []
  if (role.value === 'trainer' || role.value === 'admin') {
    management.push({ to: '/app/grading', label: 'Grading queue', icon: '✓' })
  }
  if (role.value === 'admin') {
    management.push(
      { to: '/app/users', label: 'Users', icon: '☺' },
      { to: '/app/cohorts', label: 'Cohorts', icon: '⊞' },
      { to: '/app/audit', label: 'Audit log', icon: '≡' },
    )
  }

  const personal: NavLink[] = [{ to: '/app/notifications', label: 'Notifications', icon: '◔' }]

  const result = [{ title: 'Learning', links: learning }]
  if (management.length > 0) result.push({ title: 'Management', links: management })
  result.push({ title: 'Account', links: personal })
  return result
})
</script>

<template>
  <aside class="sidebar" :class="{ open }">
    <div class="sidebar-brand">
      <span class="logo">T</span>
      <div>
        TKSR Learning
        <small>AI Academy</small>
      </div>
    </div>
    <nav>
      <template v-for="section in sections" :key="section.title">
        <div class="nav-section">{{ section.title }}</div>
        <router-link
          v-for="link in section.links"
          :key="link.to"
          :to="link.to"
          class="nav-link"
          @click="$emit('close')"
        >
          <span class="nav-icon">{{ link.icon }}</span>
          {{ link.label }}
        </router-link>
      </template>
    </nav>
    <div class="sidebar-footer small">
      <div class="muted">Signed in as</div>
      <strong style="color: #fff">{{ session.user?.name }}</strong>
      <div style="text-transform: capitalize">{{ session.user?.role }}</div>
    </div>
  </aside>
</template>
