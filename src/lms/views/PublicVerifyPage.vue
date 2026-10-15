<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { certificateApi } from '../api'
import type { Certificate } from '../types'
import { formatDate } from '../format'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const route = useRoute()

const certificate = ref<Certificate | null>(null)
const loading = ref(false)
const error = ref<unknown>(null)
const notFound = ref(false)

async function load() {
  const code = route.params.code as string
  if (!code) return
  loading.value = true
  error.value = null
  notFound.value = false
  try {
    const res = await certificateApi.verify(code)
    certificate.value = res
  } catch (e: any) {
    if (e.status === 404) {
      notFound.value = true
    } else {
      error.value = e
    }
  } finally {
    loading.value = false
  }
}

watch(() => route.params.code, load, { immediate: true })
</script>

<template>
  <div class="page" style="max-width: 720px; margin: 0 auto; padding: 2rem 1rem; text-align: center;">
    <header class="page-header" style="margin-bottom: 2rem;">
      <h1>Certificate Verification</h1>
      <p class="muted">Verify the authenticity of a TKSR certificate</p>
    </header>

    <LoadingBlock v-if="loading" message="Verifying certificate…" />
    <ErrorBlock v-else-if="error" :error="error" />

    <div v-else-if="notFound" class="card" style="background: var(--surface-2); border-color: var(--danger);">
      <EmptyState icon="❌" title="Certificate not found" description="No certificate exists with this verification code." />
    </div>

    <div v-else-if="certificate" class="certificate-card" style="background: linear-gradient(135deg, var(--surface-2), var(--surface-3)); border: 2px solid var(--gold); border-radius: 12px; padding: 2rem; text-align: left;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--gold); font-weight: 600; letter-spacing: 0.1em; margin-bottom: 0.5rem;">TKSR LEARNING · AI ACADEMY</div>
          <h2 style="font-size: 1.5rem; margin: 0;">{{ certificate.certificateTitle ?? certificate.certificateId }}</h2>
        </div>
        <div style="text-align: right;">
          <div class="small muted">Certificate ID</div>
          <div style="font-family: monospace; font-size: 0.875rem;">{{ certificate.certificateId }}</div>
        </div>
      </div>

      <hr style="border-color: var(--border); margin: 1.5rem 0;" />

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
        <div>
          <div class="small muted">Recipient</div>
          <div style="font-size: 1.125rem; font-weight: 600;">{{ certificate.studentName }}</div>
        </div>
        <div>
          <div class="small muted">Program</div>
          <div style="font-size: 1.125rem; font-weight: 600;">{{ certificate.programTitle }}</div>
        </div>
        <div>
          <div class="small muted">Completion Date</div>
          <div style="font-size: 1.125rem; font-weight: 600;">{{ formatDate(certificate.completionDate) }}</div>
        </div>
        <div v-if="certificate.signatoryName">
          <div class="small muted">Signed by</div>
          <div style="font-size: 1.125rem; font-weight: 600;">{{ certificate.signatoryName }}</div>
          <div class="small muted">{{ certificate.signatoryTitle }}</div>
        </div>
      </div>

      <hr style="border-color: var(--border); margin: 1.5rem 0;" />

      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <div class="small muted">Verification Code</div>
          <div style="font-family: monospace; font-size: 0.875rem; word-break: break-all;">{{ certificate.verificationCode }}</div>
        </div>
        <div style="color: #22c55e; font-weight: 600;">✓ Valid Certificate</div>
      </div>
    </div>
  </div>
</template>