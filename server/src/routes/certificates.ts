import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { all, get, run } from '../db/helpers.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { ApiError } from '../middleware/error.js'
import { validateBody } from '../middleware/validate.js'
import { requireProgramAccess, requireProgramManager } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { renderCertificatePdf } from '../services/certificatePdf.js'
import {
  certificateDto,
  getEligibility,
  getRules,
  issueCertificate,
} from '../services/certificates.js'
import { notify } from '../services/notifications.js'
import type { CertificateRow } from '../db/types.js'
import { paramId } from '../utils/http.js'

export const certificatesRouter = Router()
certificatesRouter.use(requireAuth)

function verificationUrlFor(code: string): string {
  return `${config.publicBaseUrl}/verify/${code}`
}

function certificateRow(id: number): CertificateRow {
  const row = get<CertificateRow>('SELECT * FROM certificates WHERE id = ?', id)
  if (!row) throw new ApiError(404, 'Certificate not found')
  return row
}

/** Only the owning student, the program's trainer or an admin may download. */
function requireCertificateAccess(user: { id: number; role: string }, row: CertificateRow): void {
  if (user.role === 'admin') return
  if (row.student_id === user.id) return
  if (user.role === 'trainer') {
    const program = get<{ trainer_id: number | null }>('SELECT trainer_id FROM programs WHERE id = ?', row.program_id)
    if (program?.trainer_id === user.id) return
  }
  throw new ApiError(403, 'You do not have access to this certificate')
}

// GET /api/my/certificates — the student's issued certificates
certificatesRouter.get('/my/certificates', (req, res, next) => {
  try {
    const rows = all<CertificateRow>(
      'SELECT * FROM certificates WHERE student_id = ? ORDER BY issued_at DESC, id DESC',
      req.user!.id,
    )
    res.json({ data: rows.map((row) => certificateDto(row, config.publicBaseUrl)) })
  } catch (error) {
    next(error)
  }
})

// GET /api/my/certificate-eligibility — eligibility per enrolled program
certificatesRouter.get('/my/certificate-eligibility', (req, res, next) => {
  try {
    const user = req.user!
    const programs = all<{ program_id: number }>(
      `SELECT DISTINCT c.program_id
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN programs p ON p.id = c.program_id AND p.status = 'published'
       WHERE e.student_id = ? AND e.status = 'active'
       ORDER BY c.program_id`,
      user.id,
    )
    const data = programs.map((row) => {
      const report = getEligibility(user.id, row.program_id)
      return {
        programId: report.programId,
        programTitle: report.programTitle,
        eligible: report.eligible,
        certificateEnabled: report.certificateEnabled,
        certificateIssued: report.certificateIssued,
        certificate: report.certificate ? certificateDto(report.certificate, config.publicBaseUrl) : null,
        lessons: report.lessons,
        assignments: { total: report.assignments.total, satisfied: report.assignments.satisfied },
        finalAssessment: report.finalAssessment
          ? {
              id: report.finalAssessment.id,
              title: report.finalAssessment.title,
              graded: report.finalAssessment.graded,
              percent: report.finalAssessment.percent,
            }
          : null,
        reasons: report.reasons,
      }
    })
    res.json({ data })
  } catch (error) {
    next(error)
  }
})

// POST /api/my/programs/:id/certificate — self-issue when eligible (name from account)
certificatesRouter.post('/my/programs/:id/certificate', (req, res, next) => {
  try {
    const user = req.user!
    const programId = paramId(req.params.id)
    requireProgramAccess(user, programId)
    const { certificate, created } = issueCertificate({ studentId: user.id, programId, issuedBy: null })
    if (created) {
      recordAudit({
        userId: user.id,
        action: 'certificate.issue',
        entityType: 'certificate',
        entityId: certificate.id,
        metadata: { programId, self: true },
        ip: req.ip,
      })
    }
    res.status(created ? 201 : 200).json({ certificate: certificateDto(certificate, config.publicBaseUrl), created })
  } catch (error) {
    next(error)
  }
})

// GET /api/certificates/:id/download — personalised PDF
certificatesRouter.get('/certificates/:id/download', async (req, res, next) => {
  try {
    const user = req.user!
    const row = certificateRow(paramId(req.params.id))
    requireCertificateAccess(user, row)
    const pdf = await renderCertificatePdf(row, verificationUrlFor(row.verification_code))
    const filename = `${row.certificate_id}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(pdf.byteLength))
    res.send(Buffer.from(pdf))
  } catch (error) {
    next(error)
  }
})

// GET /api/programs/:id/certificates — issued certificates + eligible students (admin/trainer)
certificatesRouter.get('/programs/:id/certificates', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const programId = paramId(req.params.id)
    requireProgramManager(req.user!, programId)
    const certificates = all<CertificateRow>(
      'SELECT * FROM certificates WHERE program_id = ? ORDER BY issued_at DESC, id DESC',
      programId,
    )
    const students = all<{ student_id: number; name: string; email: string }>(
      `SELECT DISTINCT e.student_id, u.name, u.email
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN users u ON u.id = e.student_id
       WHERE c.program_id = ? AND e.status = 'active'
       ORDER BY u.name`,
      programId,
    )
    const issuedByStudent = new Map(certificates.map((row) => [row.student_id, row]))
    res.json({
      certificates: certificates.map((row) => certificateDto(row, config.publicBaseUrl)),
      students: students.map((student) => {
        const report = getEligibility(student.student_id, programId)
        const issued = issuedByStudent.get(student.student_id)
        return {
          studentId: student.student_id,
          name: student.name,
          email: student.email,
          eligible: report.eligible,
          certificateIssued: Boolean(issued),
          certificateId: issued?.certificate_id ?? null,
          reasons: report.reasons,
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/programs/:id/certificates — issue a certificate for a student (admin/trainer)
certificatesRouter.post(
  '/programs/:id/certificates',
  requireRole('admin', 'trainer'),
  validateBody(z.object({ studentId: z.number().int().positive() })),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      requireProgramManager(req.user!, programId)
      const { studentId } = req.body as { studentId: number }
      const { certificate, created } = issueCertificate({ studentId, programId, issuedBy: req.user!.id })
      if (created) {
        recordAudit({
          userId: req.user!.id,
          action: 'certificate.issue',
          entityType: 'certificate',
          entityId: certificate.id,
          metadata: { programId, studentId },
          ip: req.ip,
        })
        notify({
          userId: studentId,
          title: 'Certificate issued',
          body: `Your certificate for "${certificate.program_title}" is ready to download.`,
          type: 'info',
          link: '/app/certificates',
        })
      }
      res.status(created ? 201 : 200).json({ certificate: certificateDto(certificate, config.publicBaseUrl), created })
    } catch (error) {
      next(error)
    }
  },
)

// POST /api/programs/:id/approvals — trainer/admin project approval
certificatesRouter.post(
  '/programs/:id/approvals',
  requireRole('admin', 'trainer'),
  validateBody(z.object({ studentId: z.number().int().positive(), note: z.string().trim().max(2000).default('') })),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      requireProgramManager(req.user!, programId)
      const { studentId, note } = req.body as { studentId: number; note: string }
      const student = get<{ id: number }>(
        "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'student'",
        studentId,
      )
      if (!student) throw new ApiError(404, 'Student not found')
      run(
        `INSERT INTO project_approvals (student_id, program_id, approved_by, note)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(student_id, program_id) DO UPDATE SET approved_by = excluded.approved_by,
           note = excluded.note, approved_at = excluded.approved_at, updated_at = excluded.approved_at`,
        studentId,
        programId,
        req.user!.id,
        note,
      )
      recordAudit({
        userId: req.user!.id,
        action: 'project.approve',
        entityType: 'program',
        entityId: programId,
        metadata: { studentId },
        ip: req.ip,
      })
      res.json({ eligibility: getEligibility(studentId, programId) })
    } catch (error) {
      next(error)
    }
  },
)

// DELETE /api/programs/:id/approvals/:studentId — revoke approval
certificatesRouter.delete('/programs/:id/approvals/:studentId', requireRole('admin', 'trainer'), (req, res, next) => {
  try {
    const programId = paramId(req.params.id)
    requireProgramManager(req.user!, programId)
    const studentId = paramId(req.params.studentId)
    run('DELETE FROM project_approvals WHERE student_id = ? AND program_id = ?', studentId, programId)
    recordAudit({
      userId: req.user!.id,
      action: 'project.approval_revoke',
      entityType: 'program',
      entityId: programId,
      metadata: { studentId },
      ip: req.ip,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

const rulesSchema = z.object({
  programKind: z.enum(['standard', 'one_day_project', 'seven_day_project']).optional(),
  certificateEnabled: z.boolean().optional(),
  certificateType: z.string().trim().max(200).optional(),
  passingPercent: z.number().int().min(0).max(100).optional(),
  requireAllModules: z.boolean().optional(),
  requireAllAssignments: z.boolean().optional(),
  requireFinalAssessment: z.boolean().optional(),
  finalAssignmentId: z.number().int().positive().nullable().optional(),
  requireTrainerApproval: z.boolean().optional(),
  signatoryName: z.string().trim().max(200).optional(),
  signatoryTitle: z.string().trim().max(200).optional(),
})

function rulesDto(programId: number): Record<string, unknown> {
  const rules = getRules(programId)
  if (!rules) {
    return {
      programId,
      programKind: 'standard',
      certificateEnabled: false,
      certificateType: 'Completion',
      passingPercent: 0,
      requireAllModules: true,
      requireAllAssignments: true,
      requireFinalAssessment: false,
      finalAssignmentId: null,
      requireTrainerApproval: false,
      signatoryName: 'TKSR Learning',
      signatoryTitle: 'Director of Learning',
    }
  }
  return {
    programId: rules.program_id,
    programKind: rules.program_kind,
    certificateEnabled: rules.certificate_enabled === 1,
    certificateType: rules.certificate_type,
    passingPercent: rules.passing_percent,
    requireAllModules: rules.require_all_modules === 1,
    requireAllAssignments: rules.require_all_assignments === 1,
    requireFinalAssessment: rules.require_final_assessment === 1,
    finalAssignmentId: rules.final_assignment_id,
    requireTrainerApproval: rules.require_trainer_approval === 1,
    signatoryName: rules.signatory_name,
    signatoryTitle: rules.signatory_title,
  }
}

// GET /api/programs/:id/completion-rules — read the completion/certificate config
certificatesRouter.get('/programs/:id/completion-rules', (req, res, next) => {
  try {
    const programId = paramId(req.params.id)
    requireProgramAccess(req.user!, programId)
    res.json({ rules: rulesDto(programId) })
  } catch (error) {
    next(error)
  }
})

// PUT /api/programs/:id/completion-rules — configure completion + certificate rules
certificatesRouter.put(
  '/programs/:id/completion-rules',
  requireRole('admin', 'trainer'),
  validateBody(rulesSchema),
  (req, res, next) => {
    try {
      const programId = paramId(req.params.id)
      requireProgramManager(req.user!, programId)
      const body = req.body as z.infer<typeof rulesSchema>
      if (body.finalAssignmentId != null) {
        const assignment = get<{ id: number }>(
          'SELECT id FROM assignments WHERE id = ? AND program_id = ?',
          body.finalAssignmentId,
          programId,
        )
        if (!assignment) throw new ApiError(400, 'finalAssignmentId must belong to this program')
      }
      const current = getRules(programId)
      const nowIso = new Date().toISOString()
      if (!current) {
        run(
          `INSERT INTO program_completion_rules
             (program_id, program_kind, certificate_enabled, certificate_type, passing_percent,
              require_all_modules, require_all_assignments, require_final_assessment, final_assignment_id,
              require_trainer_approval, signatory_name, signatory_title)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          programId,
          body.programKind ?? 'standard',
          body.certificateEnabled ? 1 : 0,
          body.certificateType ?? 'Completion',
          body.passingPercent ?? 0,
          body.requireAllModules === false ? 0 : 1,
          body.requireAllAssignments === false ? 0 : 1,
          body.requireFinalAssessment ? 1 : 0,
          body.finalAssignmentId ?? null,
          body.requireTrainerApproval ? 1 : 0,
          body.signatoryName ?? 'TKSR Learning',
          body.signatoryTitle ?? 'Director of Learning',
        )
      } else {
        const updates: string[] = []
        const params: unknown[] = []
        const assign = (column: string, value: unknown) => {
          updates.push(`${column} = ?`)
          params.push(value)
        }
        if (body.programKind !== undefined) assign('program_kind', body.programKind)
        if (body.certificateEnabled !== undefined) assign('certificate_enabled', body.certificateEnabled ? 1 : 0)
        if (body.certificateType !== undefined) assign('certificate_type', body.certificateType)
        if (body.passingPercent !== undefined) assign('passing_percent', body.passingPercent)
        if (body.requireAllModules !== undefined) assign('require_all_modules', body.requireAllModules ? 1 : 0)
        if (body.requireAllAssignments !== undefined) assign('require_all_assignments', body.requireAllAssignments ? 1 : 0)
        if (body.requireFinalAssessment !== undefined) assign('require_final_assessment', body.requireFinalAssessment ? 1 : 0)
        if (body.finalAssignmentId !== undefined) assign('final_assignment_id', body.finalAssignmentId)
        if (body.requireTrainerApproval !== undefined) assign('require_trainer_approval', body.requireTrainerApproval ? 1 : 0)
        if (body.signatoryName !== undefined) assign('signatory_name', body.signatoryName)
        if (body.signatoryTitle !== undefined) assign('signatory_title', body.signatoryTitle)
        assign('updated_at', nowIso)
        params.push(programId)
        run(`UPDATE program_completion_rules SET ${updates.join(', ')} WHERE program_id = ?`, ...params)
      }
      recordAudit({
        userId: req.user!.id,
        action: 'program.completion_rules_set',
        entityType: 'program',
        entityId: programId,
        metadata: { fields: Object.keys(body) },
        ip: req.ip,
      })
      res.json({ rules: rulesDto(programId) })
    } catch (error) {
      next(error)
    }
  },
)
