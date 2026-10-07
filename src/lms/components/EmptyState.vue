<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    title: string
    message?: string
  }>(),
  { icon: '◇', message: '' },
)
</script>

<template>
  <div class="state-block">
    <div class="state-icon" aria-hidden="true">{{ icon }}</div>
    <h3>{{ title }}</h3>
    <p v-if="message">{{ message }}</p>
    <slot />
  </div>
</template>
