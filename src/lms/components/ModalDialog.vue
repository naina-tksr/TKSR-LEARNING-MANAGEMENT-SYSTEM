<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    title: string
    large?: boolean
  }>(),
  { open: true, large: false },
)
void props

const emit = defineEmits<{ close: []; 'update:open': [value: boolean] }>()

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function close(): void {
  emit('close')
  emit('update:open', false)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" role="presentation" @mousedown.self="close">
      <div class="modal" :class="{ 'modal-lg': large }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="modal-head">
          <h3>{{ title }}</h3>
          <button class="modal-close" type="button" aria-label="Close" @click="close">✕</button>
        </div>
        <slot />
        <div v-if="$slots.actions" class="modal-actions">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
  /* Modal dialog styles */
</style>
