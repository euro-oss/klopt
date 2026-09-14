import { LedgerError, forwarded } from '../errors.js'

/**
 * Outbound payments (spec 7.4).
 *
 * "SEPA `pain.001` batch export for supplier payments, with a two-person
 * approval flow."
 *
 * A batch is a list of instructions and a state. The state is the interesting
 * part: it exists to make the two-person rule structural rather than a policy
 * somebody remembers, because a payment file is the one artefact this system
 * produces that moves real money out of the door.
 */

export type PaymentBatchState = 'draft' | 'submitted' | 'approved' | 'exported' | 'rejected'

export interface PaymentInstruction {
  readonly id: string
  /** BT-equivalent: the reference the payee will see. */
  readonly endToEndId: string
  readonly creditorName: string
  readonly creditorIban: string
  readonly creditorBic: string | null
  /** Unsigned minor units. A payment out is always positive here. */
  readonly amount: bigint
  readonly currency: string
  /** What the payee should reconcile it against. */
  readonly remittanceInformation: string
  /** A structured creditor reference, when the payee gave one. */
  readonly remittanceReference: string | null
}

export interface PaymentBatch {
  readonly id: string
  readonly reference: string
  readonly state: PaymentBatchState
  /** The account the money leaves from. */
  readonly debtorName: string
  readonly debtorIban: string
  readonly debtorBic: string | null
  readonly requestedExecutionDate: string
  /**
   * When the approval was given, ISO 8601, or null while unapproved.
   *
   * This is what `CreDtTm` in the pain.001 is stamped with, so the file is
   * byte-identical however often it is downloaded. Taking the clock instead
   * would mean the recorded hash did not reproduce — and "store the exact bytes
   * sent" (spec 8, rule 3) is not a claim you can make about bytes that change.
   */
  readonly approvedAt: string | null
  readonly instructions: readonly PaymentInstruction[]
}

/**
 * IBAN check digits, ISO 13616 / mod-97-10.
 *
 * Worth doing rather than pattern-matching the shape: a mistyped IBAN is the
 * commonest error in a payment file, the bank rejects the whole batch for one
 * bad account, and the check is fourteen lines. Catching it here saves an
 * afternoon of "the bank refused it and won't say why".
 */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false

  // Move the first four characters to the end, then read letters as numbers.
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0

  for (const character of rearranged) {
    const value_ =
      character >= '0' && character <= '9'
        ? character.charCodeAt(0) - 48
        : character.charCodeAt(0) - 55
    // Two digits at a time keeps every intermediate inside a safe integer,
    // which is the whole reason this is not one big BigInt division.
    remainder = (remainder * (value_ > 9 ? 100 : 10) + value_) % 97
  }

  return remainder === 1
}

/** ISO 9362. Eight or eleven characters, and the shape is all there is to check. */
export function isValidBic(value: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s/g, '').toUpperCase())
}

/**
 * Characters SEPA accepts in a name or a remittance line.
 *
 * The EPC restricts them to a Latin subset, and a bank that receives anything
 * else either rejects the file or silently transliterates it — after which the
 * payee cannot match the payment. So it is checked, and the caller is told
 * which character rather than being handed a rejected batch.
 */
const SEPA_CHARACTERS = /^[A-Za-z0-9/\-?:().,'+ ]*$/

export function offendingSepaCharacters(value: string): readonly string[] {
  return [...new Set([...value].filter((character) => !SEPA_CHARACTERS.test(character)))]
}

export interface PaymentProblem {
  readonly code:
    | 'invalid_iban'
    | 'invalid_bic'
    | 'invalid_amount'
    | 'invalid_currency'
    | 'invalid_date'
    | 'invalid_characters'
    | 'duplicate_end_to_end_id'
    | 'empty_batch'
    | 'missing_name'
  readonly path: string
  readonly message: string
}

/**
 * Everything wrong with a batch, before a bank sees it.
 *
 * All of it at once: a batch of forty instructions with three bad IBANs should
 * report three, not the first one three times over.
 */
export function validatePaymentBatch(batch: PaymentBatch): readonly PaymentProblem[] {
  const problems: PaymentProblem[] = []

  if (batch.instructions.length === 0) {
    problems.push({
      code: 'empty_batch',
      path: 'instructions',
      message: 'A payment batch with no instructions pays nobody.',
    })
  }

  if (batch.debtorName.trim() === '') {
    problems.push({ code: 'missing_name', path: 'debtorName', message: 'The payer needs a name.' })
  }
  if (!isValidIban(batch.debtorIban)) {
    problems.push({
      code: 'invalid_iban',
      path: 'debtorIban',
      message: `${batch.debtorIban} is not a valid IBAN.`,
    })
  }
  if (batch.debtorBic !== null && !isValidBic(batch.debtorBic)) {
    problems.push({
      code: 'invalid_bic',
      path: 'debtorBic',
      message: `${batch.debtorBic} is not a valid BIC.`,
    })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.requestedExecutionDate)) {
    problems.push({
      code: 'invalid_date',
      path: 'requestedExecutionDate',
      message: 'The execution date is yyyy-mm-dd.',
    })
  }

  const seen = new Set<string>()

  batch.instructions.forEach((instruction, index) => {
    const at = `instructions.${String(index)}`

    if (instruction.creditorName.trim() === '') {
      problems.push({
        code: 'missing_name',
        path: `${at}.creditorName`,
        message: 'A payee needs a name.',
      })
    }
    if (!isValidIban(instruction.creditorIban)) {
      problems.push({
        code: 'invalid_iban',
        path: `${at}.creditorIban`,
        message: `${instruction.creditorIban} is not a valid IBAN.`,
      })
    }
    if (instruction.creditorBic !== null && !isValidBic(instruction.creditorBic)) {
      problems.push({
        code: 'invalid_bic',
        path: `${at}.creditorBic`,
        message: `${instruction.creditorBic} is not a valid BIC.`,
      })
    }
    if (instruction.amount <= 0n) {
      problems.push({
        code: 'invalid_amount',
        path: `${at}.amount`,
        message: 'A payment of zero or less is not a payment.',
      })
    }
    if (instruction.currency !== 'EUR') {
      // SEPA credit transfer is a euro instrument. Anything else needs a
      // different message type, and pretending otherwise produces a file the
      // bank rejects.
      problems.push({
        code: 'invalid_currency',
        path: `${at}.currency`,
        message:
          'A SEPA credit transfer is in euro. Use a different instrument for other currencies.',
      })
    }

    if (seen.has(instruction.endToEndId)) {
      problems.push({
        code: 'duplicate_end_to_end_id',
        path: `${at}.endToEndId`,
        message: `${instruction.endToEndId} appears twice. A bank may treat that as a duplicate payment.`,
      })
    }
    seen.add(instruction.endToEndId)

    for (const [field, value] of [
      ['creditorName', instruction.creditorName],
      ['remittanceInformation', instruction.remittanceInformation],
      ['endToEndId', instruction.endToEndId],
    ] as const) {
      const offending = offendingSepaCharacters(value)
      if (offending.length > 0) {
        problems.push({
          code: 'invalid_characters',
          path: `${at}.${field}`,
          message: `SEPA does not accept ${offending.map((character) => `"${character}"`).join(', ')}.`,
        })
      }
    }
  })

  return problems
}

/** The total a `CtrlSum` has to agree with. */
export function batchTotal(batch: PaymentBatch): bigint {
  return batch.instructions.reduce((sum, instruction) => sum + instruction.amount, 0n)
}

export function assertPayable(batch: PaymentBatch): void {
  const problems = validatePaymentBatch(batch)
  if (problems.length === 0) return

  throw new LedgerError(
    problems.map((problem) =>
      forwarded('invalid_payment', problem.path, problem.message, { code: problem.code }),
    ),
  )
}
