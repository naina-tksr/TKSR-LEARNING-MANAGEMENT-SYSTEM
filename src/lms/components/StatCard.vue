<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    icon?: string
  }>(),
  { sub: '', icon: '' },
)
</script>

<template>
  <div class="stat-card">
    <span class="stat-label">
      <span v-if="icon" aria-hidden="true">{{ icon }}</span>
      {{ label }}
    </span>
    <span class="stat-value">{{ value }}</span>
    <span v-if="sub" class="stat-sub">{{ sub }}</span>
  </div>
</template>
