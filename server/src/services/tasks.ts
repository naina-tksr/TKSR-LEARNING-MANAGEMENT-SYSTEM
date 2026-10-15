import { all, get, run } from '../db/helpers.js'
import type { AssignmentTaskRow, TaskResponseRow, TaskResponseStatus } from '../db/types.js'
import { ApiError } from '../middleware/error.js'

/**
 * Per-task assessment.
 *
 * These helpers implement the grading-integrity rules (BUG-01/02/03):
 *  - every required task must have a student response and be assessed before a
 *    submission can be finalized;
 *  - unknown task ids are rejected;
 *  - task scores outside `0..maxMarks` are rejected instead of being clamped.
 */

export function listTasks(assignmentId: number): AssignmentTaskRow[] {
  return all<AssignmentTaskRow>(
    'SELECT * FROM assignment_tasks WHERE assignment_id = ? ORDER BY position, id',
    assignmentId,
  )
}

export function listTaskResponses(submissionId: number): TaskResponseRow[] {
  return all<TaskResponseRow>(
    'SELECT * FROM task_responses WHERE submission_id = ? ORDER BY task_id',
    submissionId,
  )
}

export interface TaskView {
  id: number
  assignmentId: number
  position: number
  prompt: string
  format: 'text' | 'mixed' | 'url' | 'file'
  required: boolean
  maxMarks: number
}

/** Public (camelCase) shape of a task, with `required` as a real boolean. */
export function taskView(row: AssignmentTaskRow): TaskView {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    position: row.position,
    prompt: row.prompt,
    format: row.format,
    required: row.required === 1,
    maxMarks: row.max_marks,
  }
}

export function countTasks(assignmentId: number): number {
  return get<{ total: number }>('SELECT COUNT(*) AS total FROM assignment_tasks WHERE assignment_id = ?', assignmentId)?.total ?? 0
}

export interface TaskInput {
  prompt: string
  format?: 'text' | 'mixed' | 'url' | 'file'
  required?: boolean
  maxMarks: number
}

/** Replaces the whole task list for an assignment (management only). */
export function replaceTasks(assignmentId: number, tasks: TaskInput[]): void {
  run('DELETE FROM assignment_tasks WHERE assignment_id = ?', assignmentId)
  tasks.forEach((task, index) => {
    run(
      `INSERT INTO assignment_tasks (assignment_id, position, prompt, format, required, max_marks)
       VALUES (?, ?, ?, ?, ?, ?)`,
      assignmentId,
      index,
      task.prompt,
      task.format ?? 'text',
      task.required === false ? 0 : 1,
      task.maxMarks,
    )
  })
}

export interface TaskAnswer {
  taskId: number
  responseText?: string
}

/**
 * Writes the student's per-task answers for a submission. Unknown task ids are
 * rejected (never silently ignored). Missing tasks are materialised as
 * `pending` so progress is always observable.
 */
export function syncTaskResponses(submissionId: number, assignmentId: number, answers: TaskAnswer[]): void {
  const tasks = listTasks(assignmentId)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const nowIso = new Date().toISOString()

  for (const answer of answers) {
    const task = byId.get(answer.taskId)
    if (!task) {
      throw new ApiError(400, `Unknown task id ${answer.taskId} for this assignment`)
    }
    const text = (answer.responseText ?? '').trim()
    const existing = get<{ id: number; status: TaskResponseStatus }>(
      'SELECT id, status FROM task_responses WHERE submission_id = ? AND task_id = ?',
      submissionId,
      answer.taskId,
    )
    const nextStatus: TaskResponseStatus = text.length > 0 ? 'answered' : 'pending'
    if (existing) {
      // An assessed task keeps its assessment; otherwise the status tracks the answer.
      const status = existing.status === 'assessed' ? 'assessed' : nextStatus
      run(
        'UPDATE task_responses SET response_text = ?, status = ?, updated_at = ? WHERE id = ?',
        text,
        status,
        nowIso,
        existing.id,
      )
    } else {
      run(
        'INSERT INTO task_responses (submission_id, task_id, response_text, status) VALUES (?, ?, ?, ?)',
        submissionId,
        answer.taskId,
        text,
        nextStatus,
      )
    }
  }

  // Ensure a response row exists for every task so the UI can show progress.
  for (const task of tasks) {
    const existing = get<{ id: number }>(
      'SELECT id FROM task_responses WHERE submission_id = ? AND task_id = ?',
      submissionId,
      task.id,
    )
    if (!existing) {
      run(
        'INSERT INTO task_responses (submission_id, task_id, response_text, status) VALUES (?, ?, ?, ?)',
        submissionId,
        task.id,
        '',
        'pending',
      )
    }
  }
}

export interface TaskOutstanding {
  taskId: number
  prompt: string
  status: TaskResponseStatus
  required: boolean
}

export interface TaskCompletion {
  hasTasks: boolean
  complete: boolean
  requiredTotal: number
  requiredAssessed: number
  outstanding: TaskOutstanding[]
}

/**
 * A submission may only be finalized when every required task has been
 * assessed. Returns the outstanding work otherwise.
 */
export function taskCompletion(submissionId: number, assignmentId: number): TaskCompletion {
  const tasks = listTasks(assignmentId)
  if (tasks.length === 0) {
    return { hasTasks: false, complete: true, requiredTotal: 0, requiredAssessed: 0, outstanding: [] }
  }
  const responses = new Map(listTaskResponses(submissionId).map((response) => [response.task_id, response]))
  const outstanding: TaskOutstanding[] = []
  let requiredTotal = 0
  let requiredAssessed = 0

  for (const task of tasks) {
    const response = responses.get(task.id)
    const status: TaskResponseStatus = response?.status ?? 'pending'
    if (task.required === 1) {
      requiredTotal += 1
      if (status === 'assessed') requiredAssessed += 1
      else outstanding.push({ taskId: task.id, prompt: task.prompt, status, required: true })
    } else if (status !== 'assessed') {
      outstanding.push({ taskId: task.id, prompt: task.prompt, status, required: false })
    }
  }

  return {
    hasTasks: true,
    complete: requiredTotal === requiredAssessed,
    requiredTotal,
    requiredAssessed,
    outstanding,
  }
}

export interface TaskGradeInput {
  taskId: number
  score: number
  feedback?: string
}

/**
 * Applies per-task scores. Rejects unknown task ids (BUG-02) and any score
 * outside the task's `0..maxMarks` range (BUG-03) with a clear HTTP 400.
 */
export function gradeTasks(submissionId: number, assignmentId: number, graderId: number, grades: TaskGradeInput[]): TaskResponseRow[] {
  const tasks = listTasks(assignmentId)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const nowIso = new Date().toISOString()

  // Validate everything before writing anything.
  for (const grade of grades) {
    const task = byId.get(grade.taskId)
    if (!task) {
      throw new ApiError(400, `Unknown task id ${grade.taskId} for this assignment`)
    }
    if (!Number.isInteger(grade.score)) {
      throw new ApiError(400, `Score for task ${grade.taskId} must be a whole number`)
    }
    if (grade.score < 0) {
      throw new ApiError(400, `Score for task ${grade.taskId} cannot be negative`)
    }
    if (grade.score > task.max_marks) {
      throw new ApiError(400, `Score for task ${grade.taskId} cannot exceed its maximum of ${task.max_marks}`)
    }
  }

  for (const grade of grades) {
    const response = get<{ id: number; response_text: string }>(
      'SELECT id, response_text FROM task_responses WHERE submission_id = ? AND task_id = ?',
      submissionId,
      grade.taskId,
    )
    if (!response) {
      throw new ApiError(409, `Task ${grade.taskId} has no student response to assess yet`)
    }
    if (response.response_text.trim().length === 0) {
      throw new ApiError(409, `Task ${grade.taskId} has not been answered yet and cannot be assessed`)
    }
    run(
      `UPDATE task_responses
       SET score = ?, feedback = ?, status = 'assessed', reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      grade.score,
      grade.feedback ?? null,
      graderId,
      nowIso,
      nowIso,
      response.id,
    )
  }

  return listTaskResponses(submissionId)
}
