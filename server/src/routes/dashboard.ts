import { Router } from 'express'
import { all, get } from '../db/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { getNextLesson, getProgramProgress, getStudentOverallProgress } from '../services/progress.js'
import { unreadNotificationCount } from '../services/notifications.js'
import { camelKeys, camelList } from '../utils/camel.js'

export const dashboardRouter = Router()
dashboardRouter.use(requireAuth)

// GET /api/dashboard — server composes the payload for the caller's role
dashboardRouter.get('/', (req, res, next) => {
  try {
    const user = req.user!
    if (user.role === 'admin') return res.json(adminDashboard())
    if (user.role === 'trainer') return res.json(trainerDashboard(user.id))
    return res.json(studentDashboard(user.id))
  } catch (error) {
    next(error)
  }
})

function adminDashboard() {
  const users = get<{ total: number; trainers: number; students: number; active: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN r.name = 'trainer' THEN 1 ELSE 0 END) AS trainers,
            SUM(CASE WHEN r.name = 'student' THEN 1 ELSE 0 END) AS students,
            SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS active
     FROM users u JOIN roles r ON r.id = u.role_id`,
  )
  const programs = get<{ total: number; published: number; draft: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft
     FROM programs`,
  )
  const enrollment = get<{ total: number; cohorts: number; students: number }>(
    `SELECT (SELECT COUNT(*) FROM enrollments WHERE status = 'active') AS total,
            (SELECT COUNT(*) FROM cohorts) AS cohorts,
            (SELECT COUNT(DISTINCT student_id) FROM enrollments WHERE status = 'active') AS students`,
  )
  const submissions = get<{ pending: number; graded: number }>(
    `SELECT SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'graded' THEN 1 ELSE 0 END) AS graded
     FROM submissions`,
  )
  const recentUsers = camelList(
    all(
      `SELECT u.id, u.name, u.email, u.status, u.created_at, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at DESC, u.id DESC LIMIT 5`,
    ),
  )
  const recentActivity = camelList(
    all(
      `SELECT a.id, a.action, a.entity_type, a.created_at, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
    ),
  )
  return {
    stats: {
      users: {
        total: users?.total ?? 0,
        trainers: users?.trainers ?? 0,
        students: users?.students ?? 0,
        active: users?.active ?? 0,
      },
      programs: {
        total: programs?.total ?? 0,
        published: programs?.published ?? 0,
        draft: programs?.draft ?? 0,
      },
      enrollments: {
        total: enrollment?.total ?? 0,
        cohorts: enrollment?.cohorts ?? 0,
        students: enrollment?.students ?? 0,
      },
      submissions: {
        pending: submissions?.pending ?? 0,
        graded: submissions?.graded ?? 0,
      },
    },
    recentUsers,
    recentActivity,
    unreadNotifications: 0,
  }
}

function trainerDashboard(trainerId: number) {
  const programs = camelList(
    all(
      `SELECT p.id, p.title, p.status, p.level,
              (SELECT COUNT(*) FROM modules m WHERE m.program_id = p.id) AS module_count,
              (SELECT COUNT(*) FROM cohorts c JOIN enrollments e ON e.cohort_id = c.id
                WHERE c.program_id = p.id AND e.status = 'active') AS student_count
       FROM programs p WHERE p.trainer_id = ? ORDER BY p.updated_at DESC`,
      trainerId,
    ),
  )
  const students =
    get<{ total: number }>(
      `SELECT COUNT(DISTINCT e.student_id) AS total
       FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
       JOIN programs p ON p.id = c.program_id
       WHERE p.trainer_id = ? AND e.status = 'active'`,
      trainerId,
    )?.total ?? 0
  const pending =
    get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN programs p ON p.id = a.program_id
       WHERE p.trainer_id = ? AND s.status = 'submitted'`,
      trainerId,
    )?.total ?? 0
  const assignments = camelList(
    all(
      `SELECT a.id, a.title, a.due_at, a.status, a.max_marks, p.title AS program_title,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
              (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded') AS graded_count
       FROM assignments a JOIN programs p ON p.id = a.program_id
       WHERE p.trainer_id = ?
       ORDER BY a.due_at IS NULL, a.due_at
       LIMIT 6`,
      trainerId,
    ),
  )
  const recentSubmissions = camelList(
    all(
      `SELECT s.id, s.status, s.score, s.submitted_at, s.graded_at,
              u.name AS student_name, a.title AS assignment_title, a.id AS assignment_id
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN programs p ON p.id = a.program_id
       JOIN users u ON u.id = s.student_id
       WHERE p.trainer_id = ?
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT 6`,
      trainerId,
    ),
  )
  return {
    stats: {
      programs: programs.length,
      students,
      pendingSubmissions: pending,
      assignments: get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM assignments a JOIN programs p ON p.id = a.program_id WHERE p.trainer_id = ?`,
        trainerId,
      )?.total ?? 0,
    },
    programs,
    assignments,
    recentSubmissions,
    unreadNotifications: 0,
  }
}

function studentDashboard(studentId: number) {
  const overall = getStudentOverallProgress(studentId)
  const programs = camelList(
    all<{ id: number }>(
      `SELECT DISTINCT p.id, p.title, p.level, p.description
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id AND e.student_id = ? AND e.status = 'active'
       JOIN programs p ON p.id = c.program_id AND p.status = 'published'
       ORDER BY p.title COLLATE NOCASE
       LIMIT 5`,
      studentId,
    ),
  ).map((program) => ({
    ...program,
    progress: getProgramProgress(studentId, Number((program as { id: number }).id)),
    nextLesson: getNextLesson(studentId, Number((program as { id: number }).id)),
  }))

  const pendingAssignments = camelList(
    all(
      `SELECT a.id, a.title, a.max_marks, a.due_at, p.title AS program_title, p.id AS program_id
       FROM assignments a
       JOIN programs p ON p.id = a.program_id
       WHERE a.status = 'published'
         AND p.status = 'published'
         AND (a.due_at IS NULL OR a.due_at >= datetime('now'))
         AND EXISTS (SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
                     WHERE c.program_id = a.program_id AND e.student_id = ? AND e.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = ?)
       ORDER BY a.due_at IS NULL, a.due_at
       LIMIT 5`,
      studentId,
      studentId,
    ),
  ).map((row) => ({ ...row, isOverdue: false }))

  const recentGrades = camelList(
    all(
      `SELECT s.id, s.score, s.feedback, s.graded_at, s.is_late,
              a.id AS assignment_id, a.title AS assignment_title, a.max_marks
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       WHERE s.student_id = ? AND s.status = 'graded'
       ORDER BY s.graded_at DESC, s.id DESC
       LIMIT 5`,
      studentId,
    ),
  )

  const continueLearning = programs.find((program) => program.nextLesson && !program.nextLesson.completed) ?? programs[0] ?? null

  return {
    stats: {
      programs: overall.programCount,
      overallProgress: overall.percent,
      completedLessons: overall.completedLessons,
      totalLessons: overall.totalLessons,
      pendingAssignments: get<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM assignments a
         WHERE a.status = 'published'
           AND EXISTS (SELECT 1 FROM programs p WHERE p.id = a.program_id AND p.status = 'published')
           AND EXISTS (SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
                       WHERE c.program_id = a.program_id AND e.student_id = ? AND e.status = 'active')
           AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = ?)`,
        studentId,
        studentId,
      )?.total ?? 0,
      gradedCount: get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM submissions WHERE student_id = ? AND status = 'graded'`,
        studentId,
      )?.total ?? 0,
    },
    programs,
    continueLearning: continueLearning ? camelKeys(continueLearning) : null,
    pendingAssignments,
    recentGrades,
    unreadNotifications: 0,
  }
}

// The notification badge is fetched separately so dashboards stay cacheable.
dashboardRouter.get('/notifications-badge', (req, res) => {
  res.json({ unread: unreadNotificationCount(req.user!.id) })
})
