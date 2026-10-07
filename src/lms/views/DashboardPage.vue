<script setup lang="ts">
import { computed } from 'vue'
import { session } from '../session'
import StudentDashboard from './StudentDashboard.vue'
import TrainerDashboard from './TrainerDashboard.vue'
import AdminDashboard from './AdminDashboard.vue'

const role = computed(() => session.user?.role ?? 'student')
</script>

<template>
  <StudentDashboard v-if="role === 'student'" />
  <TrainerDashboard v-else-if="role === 'trainer'" />
  <AdminDashboard v-else />
</template>
