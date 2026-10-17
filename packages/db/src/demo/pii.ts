/**
 * Guards that the demo dataset stays obviously fictional (issue #48).
 *
 * A real-looking IBAN, KvK, BSN or personal email in trial books is how a
 * demo becomes a data-protection incident. These checks run before anything is
 * written, and again in the test suite against the same dataset.
 */

const EMAIL_OK = /@(?:[a-z0-9-]+\.)*(?:example\.nl|invalid)$/i
const TEST_IBAN = /^NL\d{2}TEST\d{10}$/i
/** Nine digits that could be a BSN. */
const BSN_SHAPE = /\b\d{9}\b/

/**
 * Dutch BSN "11-proef". Returns true when the nine digits form a valid BSN.
 * Demo data must not contain any such sequence.
 */
export function isValidBsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false
  // The historical 8-digit form padded with a leading zero is rejected by the
  // modern rule that position 1 cannot contribute with weight 9 when zero —
  // but the plain 11-proef is enough to catch accidental real numbers.
  let sum = 0
  for (let i = 0; i < 8; i += 1) sum += Number(digits[i]) * (9 - i)
  sum -= Number(digits[8])
  return sum % 11 === 0
}

export interface DemoPiiSubject {
  readonly kind: string
  readonly name: string
  readonly email?: string | null
  readonly iban?: string | null
  readonly kvkNumber?: string | null
  readonly vatNumber?: string | null
  readonly notes?: string | null
}

export class DemoPiiError extends Error {
  constructor(
    readonly findings: readonly string[],
    message = `Demo dataset failed the fictional-data guard (${String(findings.length)} finding(s)).`,
  ) {
    super(message)
    this.name = 'DemoPiiError'
  }
}

function scanTextForBsn(label: string, text: string, findings: string[]): void {
  for (const match of text.matchAll(new RegExp(BSN_SHAPE, 'g'))) {
    const digits = match[0] ?? ''
    if (digits !== '' && isValidBsn(digits)) {
      findings.push(`${label}: contains a valid-looking BSN (${digits})`)
    }
  }
}

/**
 * Assert every subject in the dataset is obviously fictional.
 *
 * Throws `DemoPiiError` with every finding rather than the first, so a broken
 * dataset is fixed in one pass.
 */
export function assertFictionalDataset(subjects: readonly DemoPiiSubject[]): void {
  const findings: string[] = []

  for (const subject of subjects) {
    const label = `${subject.kind}:${subject.name}`

    if (!/\(demo\)|\(fictief\)|Demo /i.test(subject.name) && subject.kind === 'entity') {
      findings.push(`${label}: entity name must say (demo) or (fictief)`)
    }

    if (subject.email !== null && subject.email !== undefined && subject.email !== '') {
      if (!EMAIL_OK.test(subject.email)) {
        findings.push(`${label}: email must use example.nl or .invalid (got ${subject.email})`)
      }
    }

    if (subject.iban !== null && subject.iban !== undefined && subject.iban !== '') {
      const compact = subject.iban.replace(/\s/g, '').toUpperCase()
      if (!TEST_IBAN.test(compact)) {
        findings.push(`${label}: IBAN must use the NL..TEST reserved pattern (got ${compact})`)
      }
    }

    if (subject.kvkNumber !== null && subject.kvkNumber !== undefined && subject.kvkNumber !== '') {
      // Real KvK numbers are issued from a live register. Demo ones must look
      // like placeholders: leading zeros, or a block of identical digits.
      if (!/^0{4,}\d+$/.test(subject.kvkNumber) && !/^(\d)\1{7}$/.test(subject.kvkNumber)) {
        findings.push(
          `${label}: KvK must be an obvious placeholder (leading zeros or repeated digit), got ${subject.kvkNumber}`,
        )
      }
    }

    if (subject.vatNumber !== null && subject.vatNumber !== undefined && subject.vatNumber !== '') {
      const vat = subject.vatNumber.toUpperCase().replace(/\s/g, '')
      if (!/^NL0{5,}\d+B\d{2}$/.test(vat)) {
        findings.push(`${label}: BTW-id must use a zero-padded fictional pattern (got ${vat})`)
      }
    }

    scanTextForBsn(label, subject.name, findings)
    if (subject.notes !== null && subject.notes !== undefined) {
      scanTextForBsn(label, subject.notes, findings)
    }
  }

  if (findings.length > 0) throw new DemoPiiError(findings)
}
