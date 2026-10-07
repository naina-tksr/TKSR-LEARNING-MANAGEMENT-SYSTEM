<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    percent: number
    showLabel?: boolean
    success?: boolean
  }>(),
  { showLabel: true, success: false },
)

const clamped = () => Math.max(0, Math.min(100, Math.round(props.percent)))
</script>

<template>
  <div class="progress-row">
    <div class="progress" :class="{ 'progress-success': success }" role="progressbar" :aria-valuenow="clamped()">
      <div class="bar" :style="{ width: clamped() + '%' }" />
    </div>
    <span v-if="showLabel" class="pct">{{ clamped() }}%</span>
  </div>
</template>
