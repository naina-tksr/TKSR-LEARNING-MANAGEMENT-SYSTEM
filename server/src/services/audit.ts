import { run } from '../db/helpers.js'

export interface AuditInput {
  userId?: number | null
  action: string
  entityType: string
  entityId?: number | string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}

/** Records an important action in the audit log (best-effort, never throws). */
export function recordAudit(input: AuditInput): void {
  try {
    run(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.userId ?? null,
      input.action,
      input.entityType,
      input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
      JSON.stringify(input.metadata ?? {}),
      input.ip ?? null,
    )
  } catch (error) {
    console.error('[audit] Failed to record audit log:', error)
  }
}

export function clientIp(ip: string | undefined): string | null {
  return ip ?? null
}
