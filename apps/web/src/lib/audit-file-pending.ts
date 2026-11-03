/**
 * Staging XML between the import wizard and `/audit-file`.
 *
 * sessionStorage is tried first so a refresh still works for small files; when
 * quota is exceeded we keep the payload in memory for this tab only.
 */

let pendingXml: string | null = null

export function stageAuditFileXml(xml: string): { ok: true } | { ok: false; reason: 'quota' } {
  pendingXml = xml
  try {
    sessionStorage.setItem('klopt.auditFile.pending', xml)
  } catch {
    try {
      sessionStorage.removeItem('klopt.auditFile.pending')
    } catch {
      // ignore
    }
  }
  return { ok: true }
}

export function takePendingAuditFileXml(): string | null {
  if (pendingXml !== null) {
    const xml = pendingXml
    pendingXml = null
    try {
      sessionStorage.removeItem('klopt.auditFile.pending')
    } catch {
      // ignore
    }
    return xml
  }
  try {
    const stored = sessionStorage.getItem('klopt.auditFile.pending')
    sessionStorage.removeItem('klopt.auditFile.pending')
    return stored
  } catch {
    return null
  }
}

export function clearPendingAuditFileXml(): void {
  pendingXml = null
  try {
    sessionStorage.removeItem('klopt.auditFile.pending')
  } catch {
    // ignore
  }
}
