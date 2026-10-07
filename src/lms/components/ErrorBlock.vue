<script setup lang="ts">
import { formatApiError } from '../api'

withDefaults(
  defineProps<{
    error: unknown
    title?: string
  }>(),
  { title: 'Something went wrong' },
)

defineEmits<{ retry: [] }>()
</script>

<template>
  <div>
    <div class="error-banner" role="alert">
      <span><strong>{{ title }}:</strong> {{ formatApiError(error) }}</span>
      <button class="close" type="button" aria-label="Dismiss" @click="$emit('retry')">✕</button>
    </div>
    <slot />
  </div>
</template>
