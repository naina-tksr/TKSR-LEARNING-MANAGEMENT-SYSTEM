<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'

const route = useRoute()
const sidebarOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
  },
)

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') sidebarOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app-shell">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    <div class="main-col">
      <AppTopbar @toggle-menu="sidebarOpen = !sidebarOpen" />
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>
