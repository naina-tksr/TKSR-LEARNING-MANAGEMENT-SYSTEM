<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    status: string
    labels?: Record<string, string>
  }>(),
  { labels: () => ({}) },
)

const tone = computed(() => {
  switch (props.status.toLowerCase()) {
    case 'published':
    case 'graded':
    case 'active':
    case 'accepted':
    case 'completed':
      return 'success'
    case 'draft':
    case 'suggested':
    case 'submitted':
    case 'pending':
      return 'warning'
    case 'disabled':
    case 'dismissed':
    case 'overdue':
      return 'danger'
    case 'edited':
      return 'info'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <span class="badge" :class="`badge-${tone}`">{{ labels[status] ?? status }}</span>
</template>
