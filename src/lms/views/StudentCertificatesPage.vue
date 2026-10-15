<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { certificateApi, formatApiError } from '../api'
import type { Certificate, ProgramEligibility } from '../types'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'
import ModalDialog from '../components/ModalDialog.vue'

const items = ref<ProgramEligibility[]>([])
const loading = ref(true)
const error = ref<unknown>(null)

// Modal state for a single program's eligibility details
const eligibilityModal = ref(false)
const modalProgramId = ref<number | null>(null)
const modalLoading = ref(false)
const modalError = ref<unknown>(null)

const selectedProgram = computed(() => items.value.find((p) => p.programId === modalProgramId.value) || null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await certificateApi.myEligibility()
    items.value = res.data
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

async function showEligibility(programId: number): Promise<void> {
  modalProgramId.value = programId
  eligibilityModal.value = true
  modalLoading.value = true
  modalError.value = null
  try {
    // Eligibility already loaded in `items`; refresh in case it changed
    const res = await certificateApi.myEligibility()
    items.value = res.data
  } catch (e) {
    modalError.value = e
  } finally {
    modalLoading.value = false
  }
}

async function requestCertificate(programId: number): Promise<void> {
  if (!confirm('Request certificate for this program?')) return
  try {
    const result = await certificateApi.request(programId)
    alert(result.created ? 'Certificate issued successfully! Open the page again to download.' : 'A certificate has already been issued.')
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function downloadCertificate(cert: Certificate): Promise<void> {
  try {
    await certificateApi.download(cert.id)
  } catch (e) {
    alert(formatApiError(e))
  }
}

function iconFor(eligible: boolean): string {
  return eligible ? '✅' : '❌'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>My Certificates</h1>
      <p class="muted">View, download, and request certificates for completed programs</p>
    </header>

    <LoadingBlock v-if="loading" message="Loading your certificates…" />
    <ErrorBlock v-else-if="error" :error="error" @retry="load" />

    <div v-else-if="items.length === 0" class="card">
      <EmptyState icon="◆" title="No enrolled programs" description="Certificates appear here once you're enrolled in a program." />
    </div>

    <div v-else class="space-y">
      <div v-for="prog in items" :key="prog.programId" class="card">
        <div style="display: flex; gap: 1rem; justify-content: space-between; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 240px;">
            <h3 class="card-title" style="margin-bottom: 0.25rem;">{{ prog.programTitle }}</h3>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.125rem;">{{ iconFor(prog.eligible) }}</span>
              <strong>{{ prog.eligible ? 'Eligible for certificate' : 'Not yet eligible' }}</strong>
            </div>
            <p v-if="prog.reasons.length > 0" class="muted small" style="margin: 0.5rem 0 0;">
              {{ prog.reasons.join(' · ') }}
            </p>
          </div>

          <div v-if="prog.certificate" class="flex gap-2">
            <button class="btn btn-primary" @click="downloadCertificate(prog.certificate)">Download PDF</button>
          </div>
          <div v-else-if="prog.eligible">
            <button class="btn btn-primary" @click="requestCertificate(prog.programId)">Request Certificate</button>
          </div>
          <div v-else>
            <button class="btn btn-ghost" @click="showEligibility(prog.programId)">View details</button>
          </div>
        </div>

        <!-- Inline progress info -->
        <div class="mt-3 small muted" style="border-top: 1px solid var(--border); padding-top: 0.5rem;">
          <span>Lessons: {{ prog.lessons.completed }}/{{ prog.lessons.total }}</span>
          <span style="margin-left: 1rem;">Assignments: {{ prog.assignments.satisfied ? 'complete' : 'incomplete' }}</span>
          <span v-if="prog.finalAssessment" style="margin-left: 1rem;">
            Final assessment: {{ prog.finalAssessment.graded ? prog.finalAssessment.percent + '%' : 'not graded' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Eligibility Detail Modal -->
    <ModalDialog v-model:open="eligibilityModal" title="Certificate Eligibility" size="lg">
      <LoadingBlock v-if="modalLoading" message="Loading…" />
      <ErrorBlock v-else-if="modalError" :error="modalError" />

      <div v-else-if="selectedProgram" class="space-3">
        <div class="flex items-center gap-2 mb-3">
          <span style="font-size: 1.5rem">{{ iconFor(selectedProgram.eligible) }}</span>
          <strong class="text-lg">
            {{ selectedProgram.eligible ? 'Eligible for certificate' : 'Not yet eligible' }}
          </strong>
        </div>

        <p class="muted" v-if="selectedProgram.reasons.length > 0">
          {{ selectedProgram.reasons.join('. ') }}
        </p>
        <p v-else class="muted">All requirements met. You can request your certificate.</p>

        <div class="card p-3 mt-3" style="background: var(--surface-2)">
          <h4 class="mb-2">Requirements Check</h4>
          <div class="grid gap-2" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
            <div class="check-item" :class="{ pass: selectedProgram.certificateEnabled }">
              <span class="check-icon">{{ selectedProgram.certificateEnabled ? '✓' : '✗' }}</span>
              Certificates enabled for program
            </div>
            <div class="check-item" :class="{ pass: selectedProgram.enrolled !== false }">
              <span class="check-icon">{{ '✓' }}</span>
              Enrolled in program
            </div>
            <div class="check-item" :class="{ pass: selectedProgram.lessons.satisfied }">
              <span class="check-icon">{{ selectedProgram.lessons.satisfied ? '✓' : '✗' }}</span>
              All lessons complete ({{ selectedProgram.lessons.completed }}/{{ selectedProgram.lessons.total }})
            </div>
            <div class="check-item" :class="{ pass: selectedProgram.assignments.satisfied }">
              <span class="check-icon">{{ selectedProgram.assignments.satisfied ? '✓' : '✗' }}</span>
              All assignments complete
            </div>
            <div v-if="selectedProgram.finalAssessment" class="check-item" :class="{ pass: selectedProgram.finalAssessment.graded }">
              <span class="check-icon">{{ selectedProgram.finalAssessment.graded ? '✓' : '✗' }}</span>
              Final assessment passed ({{ selectedProgram.finalAssessment.percent ?? '—' }}%)
            </div>
            <div v-if="selectedProgram.certificate" class="check-item pass">
              <span class="check-icon">✓</span>
              Certificate issued
            </div>
          </div>
        </div>

        <div v-if="selectedProgram.certificate" class="mt-3">
          <button class="btn btn-primary" @click="downloadCertificate(selectedProgram.certificate)">
            Download PDF
          </button>
        </div>
        <div v-else-if="selectedProgram.eligible" class="mt-3">
          <button class="btn btn-primary" @click="requestCertificate(selectedProgram.programId)">
            Request Certificate
          </button>
        </div>
      </div>

      <EmptyState v-else icon="◆" title="No program selected" description="Pick a program to view its eligibility." />
    </ModalDialog>
  </div>
</template>

<style scoped>
.check-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border-radius: 4px;
  background: var(--surface-3);
}
.check-item.pass {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
}
.check-icon {
  font-weight: bold;
}
.space-y > * + * {
  margin-top: 1rem;
}
.mt-3 { margin-top: 0.75rem; }
.mb-3 { margin-bottom: 0.75rem; }
.flex { display: flex; }
.gap-2 { gap: 0.5rem; }
.grid { display: grid; }
.space-3 > * + * { margin-top: 0.75rem; }
.text-lg { font-size: 1.125rem; }
.small { font-size: 0.875rem; }
.muted { color: var(--text-muted); }
.card p { margin: 0; }
</style>