<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatApiError } from '../api'
import { login, session } from '../session'

const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const reveal = ref(false)

const demoAccounts = [
  { label: 'Admin — Anita Rao', email: 'admin@tksr.demo', password: 'Admin@123' },
  { label: 'Trainer — Rahul Verma', email: 'rahul@tksr.demo', password: 'Trainer@123' },
  { label: 'Student — Aarav Sharma', email: 'aarav@tksr.demo', password: 'Student@123' },
]

function fill(account: { email: string; password: string }): void {
  email.value = account.email
  password.value = account.password
  error.value = ''
}

async function submit(): Promise<void> {
  error.value = ''
  try {
    await login(email.value.trim(), password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/app'
    router.replace(redirect.startsWith('/app') ? redirect : '/app')
  } catch (cause) {
    error.value = formatApiError(cause)
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-hero">
      <div class="brand"><span class="logo">T</span> TKSR Learning</div>
      <h1>Learn AI by building,<br />not just watching.</h1>
      <p style="max-width: 430px">
        An AI-focused LMS where trainers guide cohorts through programs, review real submissions, and get an AI
        second opinion — while students keep full ownership of their graded work.
      </p>
      <ul>
        <li>Programs → cohorts → modules → lessons</li>
        <li>Assignments with rubrics, submissions and human-graded feedback</li>
        <li>AI Learning Tutor (hints only — never your homework)</li>
        <li>AI evaluation assistant: suggestions only, trainers release every grade</li>
      </ul>
    </section>

    <section class="login-form-col">
      <div class="login-card">
        <h2>Sign in</h2>
        <p class="sub">Use your academy account to continue.</p>

        <div v-if="error" class="error-banner" role="alert">
          <span>{{ error }}</span>
        </div>

        <form novalidate @submit.prevent="submit()">
          <div class="field">
            <label for="email">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              autocomplete="username"
              placeholder="you@example.com"
              required
            />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div style="position: relative">
              <input
                id="password"
                v-model="password"
                :type="reveal ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="••••••••"
                required
                style="padding-right: 64px"
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                style="position: absolute; right: 4px; top: 4px"
                @click="reveal = !reveal"
              >
                {{ reveal ? 'Hide' : 'Show' }}
              </button>
            </div>
          </div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="session.busy">
            <span v-if="session.busy" class="spinner spinner-sm" />
            {{ session.busy ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <div class="demo-accounts">
          <strong>Demo accounts (seeded database)</strong>
          <button v-for="account in demoAccounts" :key="account.email" type="button" @click="fill(account)">
            {{ account.label }} — {{ account.email }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
