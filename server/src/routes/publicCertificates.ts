import { Router } from 'express'
import { get } from '../db/helpers.js'
import { ApiError } from '../middleware/error.js'
import type { CertificateRow } from '../db/types.js'

/**
 * Public certificate verification. Only non-sensitive, printed-on-the-document
 * fields are exposed; it is reachable without authentication so employers can
 * confirm a certificate using the verification code shown on the PDF.
 */
export const publicCertificatesRouter = Router()

publicCertificatesRouter.get('/:code', (req, res, next) => {
  try {
    const code = String(req.params.code ?? '')
    const row = get<CertificateRow>('SELECT * FROM certificates WHERE verification_code = ?', code)
    if (!row) throw new ApiError(404, 'No certificate matches that verification code')
    res.json({
      verified: true,
      certificate: {
        certificateId: row.certificate_id,
        certificateTitle: row.certificate_title,
        studentName: row.student_name,
        programTitle: row.program_title,
        completionDate: row.completion_date,
        signatoryName: row.signatory_name,
        signatoryTitle: row.signatory_title,
        issuedAt: row.issued_at,
      },
    })
  } catch (error) {
    next(error)
  }
})
