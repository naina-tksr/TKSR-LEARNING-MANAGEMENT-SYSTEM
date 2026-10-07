<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api, formatApiError } from '../api'
import type { Paginated, Role, User } from '../types'
import { formatDate, formatDateTime } from '../format'
import { session } from '../session'
import ModalDialog from '../components/ModalDialog.vue'
import PaginationBar from '../components/PaginationBar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingBlock from '../components/LoadingBlock.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import EmptyState from '../components/EmptyState.vue'

const users = ref<User[]>([])
const meta = ref({ page: 1, limit: 15, total: 0, totalPages: 0 })
const loading = ref(true)
const error = ref<unknown>(null)
const page = ref(1)
const search = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const flash = ref('')

const showModal = ref(false)
const editing = ref<User | null>(null)
const modalError = ref('')
const busy = ref(false)
const form = reactive({ name: '', email: '', password: '', role: 'student' as Role, status: 'active' })

let searchTimer: number | undefined

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '15' })
    if (search.value.trim()) params.set('q', search.value.trim())
    if (roleFilter.value) params.set('role', roleFilter.value)
    if (statusFilter.value) params.set('status', statusFilter.value)
    const result = await api.get<Paginated<User>>(`/users?${params}`)
    users.value = result.data
    meta.value = result.meta
  } catch (cause) {
    error.value = cause
  } finally {
    loading.value = false
  }
}

function onSearch(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
}

watch([page, roleFilter, statusFilter], () => void load())

function openCreate(): void {
  editing.value = null
  Object.assign(form, { name: '', email: '', password: '', role: 'student', status: 'active' })
  modalError.value = ''
  showModal.value = true
}

function openEdit(user: User): void {
  editing.value = user
  Object.assign(form, { name: user.name, email: user.email, password: '', role: user.role, status: user.status })
  modalError.value = ''
  showModal.value = true
}

async function save(): Promise<void> {
  modalError.value = ''
  busy.value = true
  try {
    if (editing.value) {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        status: form.status,
      }
      if (form.password) payload.password = form.password
      await api.patch(`/users/${editing.value.id}`, payload)
      flash.value = `${form.name} updated.`
    } else {
      await api.post('/users', {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      })
      flash.value = `${form.name} created.`
    }
    showModal.value = false
    await load()
  } catch (cause) {
    modalError.value = formatApiError(cause)
  } finally {
    busy.value = false
  }
}

async function remove(user: User): Promise<void> {
  if (!window.confirm(`Delete ${user.name}'s account? This cannot be undone.`)) return
  try {
    await api.del(`/users/${user.id}`)
    flash.value = `${user.name} deleted.`
    await load()
  } catch (cause) {
    flash.value = formatApiError(cause)
  }
}

const canEdit = (user: User): boolean => user.id !== session.user?.id

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Users</h1>
        <p class="subtitle">Admins, trainers and students in the academy.</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="button" @click="openCreate()">+ New user</button>
      </div>
    </div>

    <div v-if="flash" class="alert alert-info" role="status">
      {{ flash }}
      <button class="close" type="button" style="float: right; background: none; border: none; cursor: pointer" @click="flash = ''">✕</button>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Search name or email…"
        aria-label="Search users"
        @input="onSearch()"
      />
      <select v-model="roleFilter" aria-label="Filter by role">
        <option value="">All roles</option>
        <option value="admin">Admin</option>
        <option value="trainer">Trainer</option>
        <option value="student">Student</option>
      </select>
      <select v-model="statusFilter" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
    </div>

    <ErrorBlock v-if="error" :error="error" title="Could not load users" @retry="load()" />
    <LoadingBlock v-else-if="loading" label="Loading users…" />

    <template v-else>
      <EmptyState v-if="users.length === 0" icon="☺" title="No users found" message="Try a different search or filter." />

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>
                <span class="avatar" style="display: inline-grid; vertical-align: middle; margin-right: 9px">
                  {{ user.name.slice(0, 1).toUpperCase() }}
                </span>
                <strong>{{ user.name }}</strong>
                <span v-if="user.id === session.user?.id" class="badge badge-primary" style="margin-left: 6px">you</span>
                <div class="small muted" style="margin-left: 47px">{{ user.email }}</div>
              </td>
              <td style="text-transform: capitalize">{{ user.role }}</td>
              <td><StatusBadge :status="user.status" /></td>
              <td class="nowrap">{{ formatDate(user.createdAt) }}</td>
              <td class="nowrap small">{{ user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'never' }}</td>
              <td class="text-right nowrap">
                <button class="btn btn-sm" type="button" @click="openEdit(user)">Edit</button>
                <button
                  v-if="canEdit(user)"
                  class="btn btn-sm btn-ghost"
                  type="button"
                  style="margin-left: 6px"
                  @click="remove(user)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <PaginationBar :meta="meta" :busy="loading" @page="(p) => (page = p)" />
    </template>

    <ModalDialog v-if="showModal" :title="editing ? `Edit ${editing.name}` : 'Create user'" @close="showModal = false">
      <div v-if="modalError" class="error-banner"><span>{{ modalError }}</span></div>
      <form @submit.prevent="save()">
        <div class="field">
          <label for="u-name">Full name</label>
          <input id="u-name" v-model="form.name" type="text" minlength="2" maxlength="100" required />
        </div>
        <div class="field">
          <label for="u-email">Email</label>
          <input id="u-email" v-model="form.email" type="email" maxlength="200" required />
        </div>
        <div class="field">
          <label for="u-password">Password</label>
          <input
            id="u-password"
            v-model="form.password"
            type="password"
            minlength="8"
            maxlength="200"
            :required="!editing"
            :placeholder="editing ? 'Leave blank to keep current password' : 'At least 8 characters'"
          />
        </div>
        <div class="field">
          <label for="u-role">Role</label>
          <select id="u-role" v-model="form.role">
            <option value="student">Student</option>
            <option value="trainer">Trainer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div v-if="editing" class="field">
          <label for="u-status">Status</label>
          <select id="u-status" v-model="form.status">
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <span class="hint">Disabled users cannot sign in and their sessions stop working.</span>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showModal = false">Cancel</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">
            <span v-if="busy" class="spinner spinner-sm" />
            {{ editing ? 'Save changes' : 'Create user' }}
          </button>
        </div>
      </form>
    </ModalDialog>
  </div>
</template>
