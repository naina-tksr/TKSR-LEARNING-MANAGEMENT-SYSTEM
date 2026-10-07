<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

withDefaults(
  defineProps<{
    title: string
    large?: boolean
  }>(),
  { large: false },
)

const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal-backdrop" role="presentation" @mousedown.self="$emit('close')">
    <div class="modal" :class="{ 'modal-lg': large }" role="dialog" aria-modal="true" :aria-label="title">
      <div class="modal-head">
        <h3>{{ title }}</h3>
        <button class="modal-close" type="button" aria-label="Close" @click="$emit('close')">✕</button>
      </div>
      <slot />
      <div v-if="$slots.actions" class="modal-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
