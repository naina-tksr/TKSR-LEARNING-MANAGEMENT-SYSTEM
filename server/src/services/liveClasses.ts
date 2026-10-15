import { all, get } from '../db/helpers.js'
import type { LiveClassRow } from '../db/types.js'
import { ApiError } from '../middleware/error.js'

/**
 * Live-class scheduling.
 *
 * Google Meet links are configured manually for now. The service layer keeps a
 * single validation + serialisation boundary so a Calendar/Meet API integration
 * can be added later without changing the routes or the database shape.
 */

// Standard meeting code (abc-defg-hij), plus the `/lookup/<token>` and
// `/<nickname>` forms Google also issues. Anything else is rejected.
export const GOOGLE_MEET_PATTERN =
  /^https:\/\/meet\.google\.com\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[A-Za-z0-9_-]+|[A-Za-z0-9_-]{5,})(?:[/?#][^\s]*)?$/i

export function isValidMeetUrl(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_MEET_PATTERN.test(value.trim())
}

/** Normalises and validates an optional meeting URL. */
export function normaliseMeetUrl(value: unknown): string | null {
  if (value == null || value === '') return null
  if (!isValidMeetUrl(value)) {
    throw new ApiError(400, 'Meeting link must be an approved Google Meet URL (https://meet.google.com/...)')
  }
  return value.trim()
}

export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface LiveClassView {
  id: number
  programId: number
  moduleId: number | null
  title: string
  classDate: string
  startTime: string
  timezone: string
  durationMinutes: number
  meetUrl: string | null
  trainerId: number | null
  trainerName: string | null
  instructions: string
  status: 'draft' | 'scheduled' | 'cancelled'
  programTitle?: string
  createdAt: string
  updatedAt: string
}

export function toLiveClassView(row: LiveClassRow & { trainer_name?: string | null; program_title?: string | null }): LiveClassView {
  return {
    id: row.id,
    programId: row.program_id,
    moduleId: row.module_id,
    title: row.title,
    classDate: row.class_date,
    startTime: row.start_time,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    meetUrl: row.meet_url,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name ?? null,
    instructions: row.instructions,
    status: row.status,
    ...(row.program_title != null ? { programTitle: row.program_title } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_WITH_NAMES = `
  SELECT lc.*, u.name AS trainer_name, p.title AS program_title
  FROM live_classes lc
  LEFT JOIN users u ON u.id = lc.trainer_id
  JOIN programs p ON p.id = lc.program_id
`

export function getLiveClassRow(id: number): (LiveClassRow & { trainer_name: string | null; program_title: string }) | undefined {
  return get(`${SELECT_WITH_NAMES} WHERE lc.id = ?`, id)
}

export function requireLiveClassRow(id: number): LiveClassRow & { trainer_name: string | null; program_title: string } {
  const row = getLiveClassRow(id)
  if (!row) throw new ApiError(404, 'Live class not found')
  return row
}

export function listProgramClasses(programId: number): LiveClassView[] {
  const rows = all<LiveClassRow & { trainer_name: string | null; program_title: string }>(
    `${SELECT_WITH_NAMES} WHERE lc.program_id = ? ORDER BY lc.class_date, lc.start_time, lc.id`,
    programId,
  )
  return rows.map(toLiveClassView)
}

/** Upcoming published classes for every program a student is actively enrolled in. */
export function listUpcomingForStudent(studentId: number, from = todayIsoDate()): LiveClassView[] {
  const rows = all<LiveClassRow & { trainer_name: string | null; program_title: string }>(
    `${SELECT_WITH_NAMES}
     WHERE lc.status = 'scheduled'
       AND lc.class_date >= ?
       AND lc.program_id IN (
         SELECT DISTINCT c.program_id
         FROM enrollments e
         JOIN cohorts c ON c.id = e.cohort_id
         JOIN programs p ON p.id = c.program_id
         WHERE e.student_id = ? AND e.status = 'active' AND p.status = 'published'
       )
     ORDER BY lc.class_date, lc.start_time, lc.id`,
    from,
    studentId,
  )
  return rows.map(toLiveClassView)
}
