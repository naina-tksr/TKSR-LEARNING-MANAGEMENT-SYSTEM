import { get } from '../db/helpers.js'
import type { AssignmentRow, ProgramRow, SubmissionRow } from '../db/types.js'
import { ApiError } from '../middleware/error.js'
import type { AuthUser } from '../middleware/auth.js'

export function getProgramRow(programId: number): ProgramRow | undefined {
  return get<ProgramRow>('SELECT * FROM programs WHERE id = ?', programId)
}

export function requireProgramRow(programId: number): ProgramRow {
  const program = getProgramRow(programId)
  if (!program) throw new ApiError(404, 'Program not found')
  return program
}

export function isStudentEnrolled(studentId: number, programId: number): boolean {
  const row = get<{ id: number }>(
    `SELECT e.id
     FROM enrollments e
     JOIN cohorts c ON c.id = e.cohort_id
     WHERE e.student_id = ? AND c.program_id = ? AND e.status = 'active'
     LIMIT 1`,
    studentId,
    programId,
  )
  return Boolean(row)
}

export type ProgramAccess = 'admin' | 'trainer' | 'student'

/**
 * Returns how a user may access a program, or `null` when they may not:
 * - admin: every program
 * - trainer: only programs assigned to them
 * - student: only published programs they are enrolled in
 */
export function programAccess(user: AuthUser, program: ProgramRow): ProgramAccess | null {
  if (user.role === 'admin') return 'admin'
  if (user.role === 'trainer' && program.trainer_id === user.id) return 'trainer'
  if (
    user.role === 'student' &&
    program.status === 'published' &&
    isStudentEnrolled(user.id, program.id)
  ) {
    return 'student'
  }
  return null
}

export function requireProgramAccess(
  user: AuthUser,
  programId: number,
): { program: ProgramRow; access: ProgramAccess } {
  const program = requireProgramRow(programId)
  const access = programAccess(user, program)
  if (!access) throw new ApiError(403, 'You do not have access to this program')
  return { program, access }
}

/** Write access to program content: admin or the assigned trainer only. */
export function requireProgramManager(user: AuthUser, programId: number): ProgramRow {
  const program = requireProgramRow(programId)
  if (user.role === 'admin') return program
  if (user.role === 'trainer' && program.trainer_id === user.id) return program
  throw new ApiError(403, 'You can only manage programs assigned to you')
}

export interface AssignmentContext {
  assignment: AssignmentRow
  program: ProgramRow
}

export function requireAssignmentRow(assignmentId: number): AssignmentRow {
  const assignment = get<AssignmentRow>('SELECT * FROM assignments WHERE id = ?', assignmentId)
  if (!assignment) throw new ApiError(404, 'Assignment not found')
  return assignment
}

/** Admin or assigned trainer for an assignment (grading, editing, publishing). */
export function requireAssignmentManager(user: AuthUser, assignmentId: number): AssignmentContext {
  const assignment = requireAssignmentRow(assignmentId)
  const program = requireProgramManager(user, assignment.program_id)
  return { assignment, program }
}

export interface SubmissionContext {
  submission: SubmissionRow
  assignment: AssignmentRow
  program: ProgramRow
}

export function requireSubmissionRow(submissionId: number): SubmissionRow {
  const submission = get<SubmissionRow>('SELECT * FROM submissions WHERE id = ?', submissionId)
  if (!submission) throw new ApiError(404, 'Submission not found')
  return submission
}

/**
 * Full access to a submission:
 * - the student who owns it
 * - the trainer assigned to its program
 * - any admin
 */
export function requireSubmissionAccess(
  user: AuthUser,
  submissionId: number,
): SubmissionContext {
  const submission = requireSubmissionRow(submissionId)
  const assignment = requireAssignmentRow(submission.assignment_id)
  const program = requireProgramRow(assignment.program_id)
  if (!program) throw new ApiError(404, 'Submission not found')

  if (user.role === 'admin') return { submission, assignment, program }
  if (user.role === 'trainer') {
    if (program.trainer_id !== user.id) {
      throw new ApiError(403, 'You do not have access to this submission')
    }
    return { submission, assignment, program }
  }
  if (submission.student_id === user.id) return { submission, assignment, program }
  throw new ApiError(403, 'You do not have access to this submission')
}
