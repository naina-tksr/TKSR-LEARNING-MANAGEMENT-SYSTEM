import { all, get } from '../db/helpers.js'

export interface ProgressStats {
  totalLessons: number
  completedLessons: number
  percent: number
}

function statsFrom(total: number, completed: number): ProgressStats {
  const totalLessons = total ?? 0
  const completedLessons = Math.min(completed ?? 0, totalLessons)
  return {
    totalLessons,
    completedLessons,
    percent: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
  }
}

export function getProgramProgress(studentId: number, programId: number): ProgressStats {
  const row = get<{ total: number; completed: number }>(
    `SELECT COUNT(DISTINCT l.id) AS total,
            COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN l.id END) AS completed
     FROM lessons l
     JOIN modules m ON m.id = l.module_id
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.student_id = ?
     WHERE m.program_id = ?`,
    studentId,
    programId,
  )
  return statsFrom(row?.total ?? 0, row?.completed ?? 0)
}

export function getModuleProgress(studentId: number, moduleId: number): ProgressStats {
  const row = get<{ total: number; completed: number }>(
    `SELECT COUNT(l.id) AS total,
            COUNT(CASE WHEN p.id IS NOT NULL THEN 1 END) AS completed
     FROM lessons l
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.student_id = ?
     WHERE l.module_id = ?`,
    studentId,
    moduleId,
  )
  return statsFrom(row?.total ?? 0, row?.completed ?? 0)
}

/** Overall progress of a student across every program they are enrolled in. */
export function getStudentOverallProgress(studentId: number): ProgressStats & { programCount: number } {
  const row = get<{ total: number; completed: number; programs: number }>(
    `SELECT COUNT(DISTINCT l.id) AS total,
            COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN l.id END) AS completed,
            COUNT(DISTINCT c.program_id) AS programs
     FROM cohorts c
     JOIN enrollments e ON e.cohort_id = c.id AND e.student_id = ? AND e.status = 'active'
     JOIN programs pr ON pr.id = c.program_id AND pr.status = 'published'
     JOIN modules m ON m.program_id = c.program_id
     JOIN lessons l ON l.module_id = m.id
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.student_id = ?`,
    studentId,
    studentId,
  )
  const stats = statsFrom(row?.total ?? 0, row?.completed ?? 0)
  return { ...stats, programCount: row?.programs ?? 0 }
}

export function getCompletedLessonIds(studentId: number, programId: number): Set<number> {
  const rows = all<{ lesson_id: number }>(
    `SELECT DISTINCT p.lesson_id
     FROM progress p
     JOIN lessons l ON l.id = p.lesson_id
     JOIN modules m ON m.id = l.module_id
     WHERE p.student_id = ? AND m.program_id = ?`,
    studentId,
    programId,
  )
  return new Set(rows.map((row) => row.lesson_id))
}

export interface NextLesson {
  lessonId: number
  lessonTitle: string
  moduleId: number
  moduleTitle: string
  completed: boolean
}

/** First not-yet-completed lesson in program order, falling back to lesson 1. */
export function getNextLesson(studentId: number, programId: number): NextLesson | null {
  const first = get<{ id: number; title: string; module_id: number; module_title: string }>(
    `SELECT l.id, l.title, m.id AS module_id, m.title AS module_title
     FROM lessons l JOIN modules m ON m.id = l.module_id
     WHERE m.program_id = ?
     ORDER BY m.position, l.position, l.id
     LIMIT 1`,
    programId,
  )
  if (!first) return null
  const next = get<{ id: number; title: string; module_id: number; module_title: string }>(
    `SELECT l.id, l.title, m.id AS module_id, m.title AS module_title
     FROM lessons l JOIN modules m ON m.id = l.module_id
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.student_id = ?
     WHERE m.program_id = ? AND p.id IS NULL
     ORDER BY m.position, l.position, l.id
     LIMIT 1`,
    studentId,
    programId,
  )
  const lesson = next ?? first
  return {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    moduleId: lesson.module_id,
    moduleTitle: lesson.module_title,
    completed: !next,
  }
}
