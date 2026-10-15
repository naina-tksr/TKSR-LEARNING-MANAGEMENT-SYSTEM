import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import type { CertificateRow } from '../db/types.js'

/** pdf-lib standard fonts are WinAnsi; strip anything they cannot encode. */
function safe(text: string): string {
  return (text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

/**
 * Renders a personalised A4-landscape completion certificate. The recipient name
 * and program title come from the stored certificate row (captured from the
 * authenticated account at issuance time).
 */
export async function renderCertificatePdf(row: CertificateRow, verificationUrl: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(row.certificate_title))
  doc.setAuthor('TKSR Learning')
  doc.setSubject(safe(row.program_title))
  doc.setCreator('TKSR Learning LMS')

  const page = doc.addPage([842, 595]) // A4 landscape
  const { width, height } = page.getSize()

  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.995, 0.985, 0.96) })
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: rgb(0.72, 0.53, 0.15), borderWidth: 3 })
  page.drawRectangle({ x: 33, y: 33, width: width - 66, height: height - 66, borderColor: rgb(0.09, 0.16, 0.31), borderWidth: 1 })

  const center = (text: string, font: PDFFont, size: number, y: number, color = rgb(0, 0, 0)) => {
    const value = safe(text)
    const textWidth = font.widthOfTextAtSize(value, size)
    page.drawText(value, { x: (width - textWidth) / 2, y, size, font, color })
  }

  center('TKSR LEARNING', helveticaBold, 20, height - 92, rgb(0.09, 0.16, 0.31))
  center('AI Academy', helvetica, 11, height - 112, rgb(0.42, 0.42, 0.42))
  center(row.certificate_title, serifBold, 23, height - 172, rgb(0.72, 0.53, 0.15))
  center('This is to certify that', serif, 13, height - 218, rgb(0.35, 0.35, 0.35))
  center(row.student_name, serifBold, 34, height - 268, rgb(0.09, 0.16, 0.31))
  center('has successfully completed the program', serif, 13, height - 304, rgb(0.35, 0.35, 0.35))
  center(row.program_title, serifBold, 18, height - 340, rgb(0.09, 0.16, 0.31))
  center(`Completed on ${row.completion_date}`, serif, 12, height - 374, rgb(0.42, 0.42, 0.42))

  // Signature block
  page.drawLine({
    start: { x: width / 2 - 150, y: 150 },
    end: { x: width / 2 + 150, y: 150 },
    thickness: 1,
    color: rgb(0.09, 0.16, 0.31),
  })
  center(row.signatory_name, serifBold, 13, 128, rgb(0.09, 0.16, 0.31))
  center(row.signatory_title, helvetica, 10, 112, rgb(0.42, 0.42, 0.42))

  // Footer: certificate id + verification reference
  page.drawText(safe(`Certificate ID: ${row.certificate_id}`), {
    x: 60,
    y: 60,
    size: 9,
    font: helvetica,
    color: rgb(0.42, 0.42, 0.42),
  })
  page.drawText(safe(`Verify at: ${verificationUrl}`), {
    x: 60,
    y: 47,
    size: 9,
    font: helvetica,
    color: rgb(0.42, 0.42, 0.42),
  })
  const issuedLabel = `Issued ${row.issued_at.slice(0, 10)}`
  page.drawText(issuedLabel, {
    x: width - 60 - helvetica.widthOfTextAtSize(issuedLabel, 9),
    y: 60,
    size: 9,
    font: helvetica,
    color: rgb(0.42, 0.42, 0.42),
  })

  return doc.save()
}
