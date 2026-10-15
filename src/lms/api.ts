// Thin fetch wrapper for the TKSR API: bearer token, JSON handling,
// error normalisation and 401 handling.

import type {
  LiveClass,
  CreateLiveClassInput,
  UpdateLiveClassInput,
  Certificate,
  ProgramEligibility,
  ProgramStudentCertificate,
  CompletionRules,
  AssignmentTask,
} from './types.js'

const TOKEN_KEY = 'tksr.token'

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
}

export interface ApiErrorDetail {
  field: string
  message: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  body?: unknown
  form?: FormData
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`

  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, 'Network error — could not reach the server. Is it still running?')
  }

  if (response.status === 401 && !path.startsWith('/auth/')) {
    tokenStore.clear()
    const redirect = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.assign(`/login?redirect=${redirect}`)
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as { error?: { message?: string; details?: ApiErrorDetail[] } }
    const message = envelope.error?.message ?? `Request failed (HTTP ${response.status})`
    throw new ApiError(response.status, message, envelope.error?.details)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, { body }),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  send: <T>(method: string, path: string, form: FormData): Promise<T> => request<T>(method, path, { form }),
}

/** Downloads an authorized file (e.g. a submission attachment) via a blob. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`/api${path}`, { headers })
  if (!response.ok) {
    let message = `Download failed (HTTP ${response.status})`
    try {
      const payload = (await response.json()) as { error?: { message?: string } }
      if (payload.error?.message) message = payload.error.message
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, message)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Turns zod validation details into a single readable message. */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details && error.details.length > 0) {
      return error.details.map((detail) => `${detail.field}: ${detail.message}`).join(' · ')
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}

// Live Classes
export const liveClassApi = {
  listByProgram: (programId: number) => api.get<{ data: LiveClass[] }>(`/programs/${programId}/live-classes`),
  get: (id: number) => api.get<LiveClass>(`/live-classes/${id}`),
  create: (programId: number, data: CreateLiveClassInput) =>
    api.post<LiveClass>(`/programs/${programId}/live-classes`, data),
  update: (id: number, data: UpdateLiveClassInput) =>
    api.patch<LiveClass>(`/live-classes/${id}`, data),
  publish: (id: number) => api.post<LiveClass>(`/live-classes/${id}/publish`),
  cancel: (id: number) => api.post<LiveClass>(`/live-classes/${id}/cancel`),
  delete: (id: number) => api.del<void>(`/live-classes/${id}`),
  myUpcoming: () => api.get<LiveClass[]>('/my/classes'),
}

// Certificates
export const certificateApi = {
  myList: () => api.get<{ data: Certificate[] }>('/my/certificates'),
  myEligibility: () => api.get<{ data: ProgramEligibility[] }>('/my/certificate-eligibility'),
  request: (programId: number) =>
    api.post<{ certificate: Certificate; created: boolean }>(`/my/programs/${programId}/certificate`),
  download: (certificateId: number) => downloadFile(`/certificates/${certificateId}/download`, `certificate-${certificateId}.pdf`),
  verify: (code: string) => api.get<Certificate>(`/public/certificates/${code}`),
  // Staff
  listByProgram: (programId: number) => api.get<{ certificates?: Certificate[]; students: ProgramStudentCertificate[] }>(`/programs/${programId}/certificates`),
  issue: (programId: number, studentId: number) => api.post<{ certificate: Certificate; created: boolean }>(`/programs/${programId}/certificates`, { studentId }),
  addApproval: (programId: number, studentId: number) => api.post<void>(`/programs/${programId}/approvals`, { studentId }),
  removeApproval: (programId: number, studentId: number) => api.del<void>(`/programs/${programId}/approvals/${studentId}`),
  getRules: (programId: number) => api.get<{ rules: CompletionRules }>(`/programs/${programId}/completion-rules`),
  setRules: (programId: number, data: CompletionRules) =>
    api.put<{ rules: CompletionRules }>(`/programs/${programId}/completion-rules`, data),
}

// Assignment Tasks
export const assignmentTaskApi = {
  get: (assignmentId: number) => api.get<AssignmentTask[]>(`/assignments/${assignmentId}/tasks`),
  replace: (assignmentId: number, tasks: AssignmentTask[]) =>
    api.put<{ tasks: AssignmentTask[] }>(`/assignments/${assignmentId}/tasks`, { tasks }),
}

// Submission Task Grades
export const submissionTaskApi = {
  grade: (submissionId: number, grades: { taskId: number; score: number; feedback?: string }[]) =>
    api.post<void>(`/submissions/${submissionId}/task-grades`, { grades }),
}
