<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { certificateApi, formatApiError } from '../api'
import type { Certificate, CompletionRules } from '../types'
import { formatDate, formatDateTime } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const programId = computed(() => Number(route.params.id))

const certificates = ref<Certificate[]>([])
const loading = ref(true)
const error = ref<unknown>(null)

const issueModal = ref(false)
const students = ref<{ id: number; name: string; email: string }[]>([])
const selectedStudentId = ref<number | null>(null)

const rulesModal = ref(false)
const rulesForm = ref<CompletionRules>({
  programKind: 'general',
  passingPercent: 70,
  requireAllModules: true,
  requireAllAssignments: true,
  requireFinalAssessment: false,
  finalAssignmentId: null,
  signatoryName: '',
  signatoryTitle: '',
  certificateEnabled: true,
  certificateType: 'Completion',
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await certificateApi.listByProgram(programId.value)
    students.value = res.students.map(s => ({ id: s.studentId, name: s.name, email: s.email }))
    certificates.value = res.certificates ?? []
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

async function loadStudents() {
  // This would need an API endpoint; for now we'll use a placeholder
  // In a real implementation, you'd fetch enrolled students for the program
  students.value = []
}

async function handleIssue() {
  if (!selectedStudentId.value) return
  try {
    await certificateApi.issue(programId.value, selectedStudentId.value)
    issueModal.value = false
    selectedStudentId.value = null
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function handleAddApproval(studentId: number) {
  if (!confirm('Add trainer approval for this student?')) return
  try {
    await certificateApi.addApproval(programId.value, studentId)
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function handleRemoveApproval(studentId: number) {
  if (!confirm('Remove trainer approval for this student?')) return
  try {
    await certificateApi.removeApproval(programId.value, studentId)
    await load()
  } catch (e) {
    alert(formatApiError(e))
  }
}

async function loadRules() {
  try {
    const { rules } = await certificateApi.getRules(programId.value)
    rulesForm.value = { ...rulesForm.value, ...rules }
  } catch (e) {
    // If no rules exist, keep defaults
  }
}

async function handleSaveRules() {
  try {
    await certificateApi.setRules(programId.value, rulesForm.value)
    rulesModal.value = false
    alert('Completion rules saved')
  } catch (e) {
    alert(formatApiError(e))
  }
}

function openRules() {
  loadRules()
  rulesModal.value = true
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>Certificates</h1>
        <p class="muted">Manage certificate issuance and completion rules</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary" @click="openRules">Completion Rules</button>
        <button class="btn btn-primary" @click="loadStudents(); issueModal = true">Issue Certificate</button>
      </div>
    </header>

    <LoadingBlock v-if="loading" message="Loading certificates…" />
    <ErrorBlock v-else-if="error" :error="error" @retry="load" />

    <div v-else class="card">
      <table class="data-table" v-if="certificates.length > 0">
        <thead>
          <tr>
            <th>Student</th>
            <th>Certificate ID</th>
            <th>Title</th>
            <th>Completion Date</th>
            <th>Issued</th>
            <th>Trainer Approved</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cert in certificates" :key="cert.id">
            <td>
              <strong>{{ cert.studentName }}</strong>
              <br />
              <span class="muted small">{{ cert.programTitle }}</span>
            </td>
            <td><code>{{ cert.certificateId }}</code></td>
            <td>{{ cert.certificateTitle }}</td>
            <td>{{ formatDate(cert.completionDate) }}</td>
            <td>{{ formatDateTime(cert.issuedAt) }}</td>
            <td>
              <StatusBadge :status="cert.signatoryName ? 'approved' : 'pending'" />
            </td>
            <td>
              <div class="flex gap-1">
                <button class="btn btn-ghost btn-sm" @click="handleRemoveApproval(cert.studentId)" v-if="cert.signatoryName">
                  Remove Approval
                </button>
                <button class="btn btn-primary btn-sm" @click="handleAddApproval(cert.studentId)" v-else>
                  Add Approval
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <EmptyState v-else icon="◆" title="No certificates issued" description="Certificates will appear here as students complete the program and are approved." />
    </div>

    <!-- Issue Certificate Modal -->
    <ModalDialog v-model:open="issueModal" title="Issue Certificate" size="md">
      <template #default>
        <div v-if="students.length === 0" class="muted text-center py-4">
          No eligible students found. Students must complete all requirements first.
        </div>
        <div v-else>
          <div class="field">
            <label>Student</label>
            <select v-model="selectedStudentId" class="select" required>
              <option value="">Select a student</option>
              <option v-for="s in students" :key="s.id" :value="s.id">{{ s.name }} ({{ s.email }})</option>
            </select>
          </div>
          <div class="flex gap-2 justify-end mt-4">
            <button class="btn btn-ghost" @click="issueModal = false">Cancel</button>
            <button class="btn btn-primary" @click="handleIssue" :disabled="!selectedStudentId">Issue Certificate</button>
          </div>
        </div>
      </template>
    </ModalDialog>

    <!-- Completion Rules Modal -->
    <ModalDialog v-model:open="rulesModal" title="Completion Rules" size="lg">
      <template #default>
        <form @submit.prevent="handleSaveRules" class="form-grid">
          <div class="field">
            <label>Program Kind</label>
            <select v-model="rulesForm.programKind" class="select">
              <option value="1_day_project">1-Day Project</option>
              <option value="7_day_project">7-Day Project</option>
              <option value="general">General</option>
            </select>
          </div>
          <div class="field">
            <label>Passing Percent (%)</label>
            <input v-model.number="rulesForm.passingPercent" type="number" min="0" max="100" class="select" />
          </div>
          <div class="field">
            <label>Require All Modules</label>
            <select v-model="rulesForm.requireAllModules" class="select">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div class="field">
            <label>Require All Assignments</label>
            <select v-model="rulesForm.requireAllAssignments" class="select">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div class="field">
            <label>Require Final Assessment</label>
            <select v-model="rulesForm.requireFinalAssessment" class="select">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div class="field">
            <label>Final Assignment ID (if required)</label>
            <input v-model.number="rulesForm.finalAssignmentId" type="number" placeholder="Assignment ID" class="select" />
          </div>
          <div class="field">
            <label>Certificate Enabled</label>
            <select v-model="rulesForm.certificateEnabled" class="select">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div class="field">
            <label>Certificate Type</label>
            <input v-model="rulesForm.certificateType" type="text" placeholder="e.g. Completion" class="select" />
          </div>
          <div class="field">
            <label>Signatory Name</label>
            <input v-model="rulesForm.signatoryName" type="text" placeholder="e.g. Dr. Jane Smith" class="select" />
          </div>
          <div class="field">
            <label>Signatory Title</label>
            <input v-model="rulesForm.signatoryTitle" type="text" placeholder="e.g. Program Director" class="select" />
          </div>
          <div class="flex gap-2" style="grid-column: 1 / -1; margin-top: 0.5rem;">
            <button type="button" class="btn btn-ghost" @click="rulesModal = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Rules</button>
          </div>
        </form>
      </template>
    </ModalDialog>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field label {
  font-size: 0.875rem;
  font-weight: 500;
}
.select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
input, select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.flex { display: flex; }
.gap-2 { gap: 0.5rem; }
.justify-end { justify-content: flex-end; }
.mt-4 { margin-top: 1rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.text-center { text-align: center; }
.btn-sm { padding: 0.25rem 0.75rem; font-size: 0.8125rem; }
</style>