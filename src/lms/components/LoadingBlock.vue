<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading…' })
</script>

<template>
  <div class="state-block" role="status" aria-live="polite">
    <div class="spinner" />
    <p style="margin-top: 12px">{{ label }}</p>
  </div>
</template>
