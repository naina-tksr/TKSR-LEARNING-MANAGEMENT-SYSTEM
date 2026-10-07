<script setup lang="ts">
import { computed } from 'vue'
import type { PageMeta } from '../types'

const props = defineProps<{ meta: PageMeta; busy?: boolean }>()
const emit = defineEmits<{ page: [page: number] }>()

const rangeStart = computed(() => (metaTotal() === 0 ? 0 : (props.meta.page - 1) * props.meta.limit + 1))
const rangeEnd = computed(() => Math.min(props.meta.page * props.meta.limit, metaTotal()))

function metaTotal(): number {
  return props.meta.total
}

const canPrev = computed(() => props.meta.page > 1 && !props.busy)
const canNext = computed(() => props.meta.page < props.meta.totalPages && !props.busy)
</script>

<template>
  <div class="pagination">
    <span class="info">
      {{ rangeStart }}–{{ rangeEnd }} of {{ meta.total }}
      <template v-if="meta.totalPages > 1"> · page {{ meta.page }}/{{ meta.totalPages }}</template>
    </span>
    <span v-if="meta.totalPages > 1" class="controls">
      <button class="btn btn-sm" type="button" :disabled="!canPrev" @click="emit('page', meta.page - 1)">‹ Prev</button>
      <button class="btn btn-sm" type="button" :disabled="!canNext" @click="emit('page', meta.page + 1)">Next ›</button>
    </span>
  </div>
</template>
