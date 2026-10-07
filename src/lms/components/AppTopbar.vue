<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import { logout, session } from '../session'
import { initials } from '../format'

defineEmits<{ toggleMenu: [] }>()

const route = useRoute()
const unread = ref(0)
let timer: number | undefined

const pageTitle = computed(() => String(route.meta.title ?? 'TKSR Learning'))
const user = computed(() => session.user)

async function loadBadge(): Promise<void> {
  try {
    const result = await api.get<{ unread: number }>('/dashboard/notifications-badge')
    unread.value = result.unread
  } catch {
    /* badge is non-critical */
  }
}

onMounted(() => {
  void loadBadge()
  timer = window.setInterval(loadBadge, 45_000)
})

onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
})
</script>

<template>
  <header class="topbar">
    <button class="menu-toggle" type="button" aria-label="Toggle navigation" @click="$emit('toggleMenu')">☰</button>
    <span class="page-title">{{ pageTitle }}</span>
    <span class="spacer" />

    <router-link to="/app/notifications" class="bell" aria-label="Notifications">
      ◔
      <span v-if="unread > 0" class="dot">{{ unread > 9 ? '9+' : unread }}</span>
    </router-link>

    <div v-if="user" class="user-chip">
      <span class="avatar">{{ initials(user.name) }}</span>
      <span class="meta">
        <strong>{{ user.name }}</strong>
        <span>{{ user.role }}</span>
      </span>
      <button class="btn btn-sm" type="button" @click="logout()">Sign out</button>
    </div>
  </header>
</template>
