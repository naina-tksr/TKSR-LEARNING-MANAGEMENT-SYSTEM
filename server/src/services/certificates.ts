import crypto from 'node:crypto'
import { all, get, run, tx } from '../db/helpers.js'
import type { CertificateRow, ProgramCompletionRulesRow, ProgramRow } from '../db/types.js'
import { ApiError } from '../middleware/error.js'
import { isStudentEnrolled } from './access.js'
import { getProgramProgress } from './progress.js'
import { countTasks, taskCompletion } from './tasks.js'

export function getRules(programId: number): ProgramCompletionRulesRow | undefined {
  return get<ProgramCompletionRulesRow>('SELECT * FROM program_completion_rules WHERE program_id = ?', programId)
}

export interface EligibilityAssignment {
  id: number
  title: string
  maxMarks: number
  submissionId: number | null
  graded: boolean
  tasksComplete: boolean
  score: number | null
  percent: number | null
  passed: boolean
}

export interface EligibilityReport {
  studentId: number
  programId: number
  programTitle: string
  eligible: boolean
  certificateEnabled: boolean
  enrolled: boolean
  passingPercent: number
  requireAllModules: boolean
  requireAllAssignments: boolean
  requireFinalAssessment: boolean
  requireTrainerApproval: boolean
  lessons: { total: number; completed: number; percent: number; satisfied: boolean }
  assignments: { total: number; satisfied: boolean; items: EligibilityAssignment[] }
  finalAssessment: EligibilityAssignment | null
  trainerApproved: boolean
  certificateIssued: boolean
  certificate: CertificateRow | null
  reasons: string[]
}

interface RawAssignment {
  id: number
  title: string
  max_marks: number
  submission_id: number | null
  submission_status: string | null
  score: number | null
}

function loadAssignments(programId: number, studentId: number): EligibilityAssignment[] {
  const rows = all<RawAssignment>(
    `SELECT a.id, a.title, a.max_marks,
            s.id AS submission_id, s.status AS submission_status, s.score
     FROM assignments a
     LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
     WHERE a.program_id = ? AND a.status = 'published'
     ORDER BY a.id`,
    studentId,
    programId,
  )
  return rows.map((row) => {
    const graded = row.submission_status === 'graded'
    const maxMarks = row.max_marks
    const score = row.score
    const percent = maxMarks > 0 && score != null ? Math.round((score / maxMarks) * 100) : null
    const tasksComplete =
      countTasks(row.id) === 0 || (row.submission_id != null && taskCompletion(row.submission_id, row.id).complete)
    return {
      id: row.id,
      title: row.title,
      maxMarks,
      submissionId: row.submission_id,
      graded,
      tasksComplete,
      score,
      percent,
      passed: graded && (percent ?? 0) >= 0,
    }
  })
}

/**
 * Backend source of truth for certificate eligibility.
 *
 * Merely opening a lesson, clicking Join, or submitting a partial assignment
 * never counts: the student needs an active enrollment, the configured module /
 * assignment coverage, every required task assessed, a passing final assessment
 * and (when configured) trainer approval.
 */
export function getEligibility(studentId: number, programId: number): EligibilityReport {
  const program = get<ProgramRow>('SELECT * FROM programs WHERE id = ?', programId)
  if (!program) throw new ApiError(404, 'Program not found')
  const rules = getRules(programId)
  const passingPercent = rules?.passing_percent ?? 0
  const requireAllModules = (rules?.require_all_modules ?? 1) === 1
  const requireAllAssignments = (rules?.require_all_assignments ?? 1) === 1
  const requireFinalAssessment = (rules?.require_final_assessment ?? 0) === 1
  const requireTrainerApproval = (rules?.require_trainer_approval ?? 0) === 1
  const certificateEnabled = (rules?.certificate_enabled ?? 0) === 1

  const enrolled = isStudentEnrolled(studentId, programId)
  const progress = getProgramProgress(studentId, programId)
  const assignments = loadAssignments(programId, studentId)

  const modulesSatisfied = progress.totalLessons > 0 && progress.completedLessons === progress.totalLessons

  const assignmentsSatisfied =
    assignments.length > 0 &&
    assignments.every((item) => item.graded && item.tasksComplete && (item.percent ?? 0) >= passingPercent)

  const finalAssessment =
    rules?.final_assignment_id != null
      ? assignments.find((item) => item.id === rules.final_assignment_id) ?? null
      : null
  const finalSatisfied = finalAssessment
    ? finalAssessment.graded &&
      finalAssessment.tasksComplete &&
      (finalAssessment.percent ?? 0) >= passingPercent
    : false

  const approval = get<{ id: number }>(
    'SELECT id FROM project_approvals WHERE student_id = ? AND program_id = ?',
    studentId,
    programId,
  )
  const trainerApproved = Boolean(approval)

  const certificate =
    get<CertificateRow>('SELECT * FROM certificates WHERE student_id = ? AND program_id = ?', studentId, programId) ?? null

  const reasons: string[] = []
  if (!certificateEnabled) reasons.push('Certificates are not enabled for this program.')
  if (!enrolled) reasons.push('You are not actively enrolled in this program.')
  if (program.status !== 'published') reasons.push('This program is not published yet.')
  if (requireAllModules && !modulesSatisfied) {
    reasons.push(`Complete all lessons (${progress.completedLessons}/${progress.totalLessons} done).`)
  }
  if (requireAllAssignments && !assignmentsSatisfied) {
    const incomplete = assignments.filter(
      (item) => !item.graded || !item.tasksComplete || (item.percent ?? 0) < passingPercent,
    )
    if (incomplete.length > 0) {
      reasons.push(`Complete and pass all assignments (${incomplete.length} outstanding).`)
    } else if (assignments.length === 0) {
      reasons.push('This program has no published assignments to complete.')
    }
  }
  if (requireFinalAssessment) {
    if (!finalAssessment) {
      reasons.push('The final assessment is not configured for this program.')
    } else if (!finalSatisfied) {
      reasons.push(`Pass the final assessment "${finalAssessment.title}" (needs ${passingPercent}% or more).`)
    }
  }
  if (requireTrainerApproval && !trainerApproved) {
    reasons.push('Trainer approval is still pending.')
  }

  const eligible =
    certificateEnabled &&
    enrolled &&
    program.status === 'published' &&
    (!requireAllModules || modulesSatisfied) &&
    (!requireAllAssignments || assignmentsSatisfied) &&
    (!requireFinalAssessment || finalSatisfied) &&
    (!requireTrainerApproval || trainerApproved)

  return {
    studentId,
    programId,
    programTitle: program.title,
    eligible,
    certificateEnabled,
    enrolled,
    passingPercent,
    requireAllModules,
    requireAllAssignments,
    requireFinalAssessment,
    requireTrainerApproval,
    lessons: {
      total: progress.totalLessons,
      completed: progress.completedLessons,
      percent: progress.percent,
      satisfied: modulesSatisfied,
    },
    assignments: { total: assignments.length, satisfied: assignmentsSatisfied, items: assignments },
    finalAssessment,
    trainerApproved,
    certificateIssued: Boolean(certificate),
    certificate,
    reasons,
  }
}

export function certificateTitle(kind: string | undefined, fallback: string): string {
  if (kind === 'one_day_project') return 'TKSR Learning — 1-Day Project Completion Certificate'
  if (kind === 'seven_day_project') return 'TKSR Learning — 7-Day Project Completion Certificate'
  return fallback || 'TKSR Learning — Certificate of Completion'
}

function kindCode(kind: string | undefined): string {
  if (kind === 'one_day_project') return '1D'
  if (kind === 'seven_day_project') return '7D'
  return 'GEN'
}

function newCertificateId(kind: string | undefined): string {
  const year = new Date().getUTCFullYear()
  const random = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `TKSR-${kindCode(kind)}-${year}-${random}`
}

/**
 * Issues a certificate exactly once per student/program. Re-issuance returns the
 * existing certificate (controlled idempotency) rather than creating a duplicate.
 */
export function issueCertificate(opts: {
  studentId: number
  programId: number
  issuedBy: number | null
}): { certificate: CertificateRow; created: boolean } {
  const student = get<{ id: number; name: string }>('SELECT id, name FROM users WHERE id = ?', opts.studentId)
  if (!student) throw new ApiError(404, 'Student not found')
  const program = get<ProgramRow>('SELECT * FROM programs WHERE id = ?', opts.programId)
  if (!program) throw new ApiError(404, 'Program not found')

  const existing = get<CertificateRow>(
    'SELECT * FROM certificates WHERE student_id = ? AND program_id = ?',
    opts.studentId,
    opts.programId,
  )
  if (existing) return { certificate: existing, created: false }

  const report = getEligibility(opts.studentId, opts.programId)
  if (!report.eligible) {
    throw new ApiError(
      409,
      'The student is not eligible for a certificate yet',
      report.reasons.map((reason) => ({ field: 'eligibility', message: reason })),
    )
  }

  const rules = getRules(opts.programId)
  const title = certificateTitle(rules?.program_kind, rules?.certificate_type ?? program.title)
  const completionDate = new Date().toISOString().slice(0, 10)
  const signatoryName = rules?.signatory_name ?? 'TKSR Learning'
  const signatoryTitle = rules?.signatory_title ?? 'Director of Learning'

  // Insert inside a transaction; the UNIQUE(student_id, program_id) index guards
  // against a concurrent duplicate becoming a second certificate.
  const certificate = tx(() => {
    const again = get<CertificateRow>(
      'SELECT * FROM certificates WHERE student_id = ? AND program_id = ?',
      opts.studentId,
      opts.programId,
    )
    if (again) return again
    const result = run(
      `INSERT INTO certificates
         (certificate_id, verification_code, student_id, program_id, certificate_type, certificate_title,
          student_name, program_title, completion_date, signatory_name, signatory_title, issued_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newCertificateId(rules?.program_kind),
      crypto.randomBytes(9).toString('base64url').toUpperCase(),
      opts.studentId,
      opts.programId,
      rules?.program_kind ?? 'standard',
      title,
      student.name,
      program.title,
      completionDate,
      signatoryName,
      signatoryTitle,
      opts.issuedBy,
      JSON.stringify({ eligibleAt: new Date().toISOString() }),
    )
    return get<CertificateRow>('SELECT * FROM certificates WHERE id = ?', result.lastInsertRowid)!
  })

  return { certificate, created: true }
}

export function certificateDto(row: CertificateRow, verificationBaseUrl: string): Record<string, unknown> {
  return {
    id: row.id,
    certificateId: row.certificate_id,
    verificationCode: row.verification_code,
    studentId: row.student_id,
    programId: row.program_id,
    certificateType: row.certificate_type,
    certificateTitle: row.certificate_title,
    studentName: row.student_name,
    programTitle: row.program_title,
    completionDate: row.completion_date,
    signatoryName: row.signatory_name,
    signatoryTitle: row.signatory_title,
    issuedAt: row.issued_at,
    verificationUrl: `${verificationBaseUrl}/verify/${row.verification_code}`,
    downloadUrl: `/api/certificates/${row.id}/download`,
  }
}
