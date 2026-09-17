import { escapeXml } from '../xaf/generate.js'
import { batchTotal, type PaymentBatch, type PaymentInstruction } from './model.js'

/**
 * SEPA `pain.001`, the customer credit transfer initiation (spec 7.4).
 *
 * Written by hand against the message definition for the same reasons XAF and
 * UBL are: the sequences are ordered, so the order of the writes below *is* the
 * contract, and every amount is a two-decimal string produced from a bigint
 * without touching a float. A payment file that is out by a cent is a payment
 * file that is out by a cent.
 *
 * **The version is `pain.001.001.03`.** Not the newest — the 2019 message is
 * `.09` — but the one every Dutch bank still accepts, and the one the EPC
 * implementation guidelines were written against. A file the bank refuses to
 * open is worth nothing, so the choice is compatibility. The namespace is the
 * only thing that changes for `.09`, which is why it is a parameter.
 *
 * Unlike XAF and UBL there is **no schema in the repository to validate
 * against**: ISO 20022 publishes its XSDs behind registration and their
 * redistribution terms are not settled, so vendoring one would repeat the
 * question ADR 0011 already has open. `validatePaymentBatch` does the
 * structural checking instead — including the IBAN check digits, which no XSD
 * would have caught — and the golden-file test validates against a schema if an
 * operator has put one in `reference-data/pain/`.
 */

export type Pain001Version = 'pain.001.001.03' | 'pain.001.001.09'

const INDENT = '  '

class XmlWriter {
  private readonly parts: string[] = []
  private depth = 0

  open(name: string, attributes: Record<string, string> = {}): void {
    const attrs = Object.entries(attributes)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join('')
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attrs}>\n`)
    this.depth += 1
  }

  close(name: string): void {
    this.depth -= 1
    this.parts.push(`${INDENT.repeat(this.depth)}</${name}>\n`)
  }

  leaf(name: string, value: string | null, attributes: Record<string, string> = {}): void {
    if (value === null) return
    const attrs = Object.entries(attributes)
      .map(([key, attribute]) => ` ${key}="${escapeXml(attribute)}"`)
      .join('')
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attrs}>${escapeXml(value)}</${name}>\n`)
  }

  toString(): string {
    return this.parts.join('')
  }
}

/** Minor units to the two-decimal string the message wants, via integers. */
export function painAmount(minorUnits: bigint): string {
  if (minorUnits < 0n) {
    throw new Error(`A payment amount is unsigned: got ${minorUnits.toString()}.`)
  }
  const digits = minorUnits.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/**
 * Trim to the field's maximum length, on a word boundary where possible.
 *
 * SEPA caps a name at 70 characters and a remittance line at 140. A bank that
 * receives more either rejects the file or truncates it itself, mid-word, in
 * the middle of the reference the payee needs.
 */
export function painText(value: string, maximum: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maximum) return collapsed

  const cut = collapsed.slice(0, maximum)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > maximum - 20 ? cut.slice(0, lastSpace) : cut
}

function writeInstruction(writer: XmlWriter, instruction: PaymentInstruction): void {
  writer.open('CdtTrfTxInf')

  writer.open('PmtId')
  writer.leaf('EndToEndId', painText(instruction.endToEndId, 35))
  writer.close('PmtId')

  writer.open('Amt')
  writer.leaf('InstdAmt', painAmount(instruction.amount), { Ccy: instruction.currency })
  writer.close('Amt')

  // Optional for SEPA since 2016: the IBAN's country and check digits are
  // enough to route it. Written when known, because some banks still prefer it.
  if (instruction.creditorBic !== null) {
    writer.open('CdtrAgt')
    writer.open('FinInstnId')
    writer.leaf('BIC', instruction.creditorBic.toUpperCase())
    writer.close('FinInstnId')
    writer.close('CdtrAgt')
  }

  writer.open('Cdtr')
  writer.leaf('Nm', painText(instruction.creditorName, 70))
  writer.close('Cdtr')

  writer.open('CdtrAcct')
  writer.open('Id')
  writer.leaf('IBAN', instruction.creditorIban.replace(/\s/g, '').toUpperCase())
  writer.close('Id')
  writer.close('CdtrAcct')

  /**
   * Structured or unstructured, never both — the message allows one or the
   * other and a bank rejects a file with both. A structured reference is
   * preferred when there is one, because it is what the payee's system matches
   * on automatically.
   */
  writer.open('RmtInf')
  if (instruction.remittanceReference !== null && instruction.remittanceReference !== '') {
    writer.open('Strd')
    writer.open('CdtrRefInf')
    writer.open('Tp')
    writer.open('CdOrPrtry')
    writer.leaf('Cd', 'SCOR')
    writer.close('CdOrPrtry')
    writer.close('Tp')
    writer.leaf('Ref', painText(instruction.remittanceReference, 35))
    writer.close('CdtrRefInf')
    writer.close('Strd')
  } else {
    writer.leaf('Ustrd', painText(instruction.remittanceInformation, 140))
  }
  writer.close('RmtInf')

  writer.close('CdtTrfTxInf')
}

export interface Pain001Options {
  readonly version?: Pain001Version
  /** When the file was produced. Injected so a golden file is stable. */
  readonly createdAt?: string
  /** The party initiating, if it differs from the account holder. */
  readonly initiatingParty?: string
}

export function generatePain001(batch: PaymentBatch, options: Pain001Options = {}): string {
  const version = options.version ?? 'pain.001.001.03'
  /**
   * The batch's approval, not the clock.
   *
   * A payment file has to be reproducible: the hash recorded in the evidence
   * chain is the hash of the bytes that went to the bank, and a `CreDtTm` read
   * from the clock makes a second download a different file. The approval is
   * the moment the batch became final, which is exactly what this element
   * means. The explicit option remains for the golden test.
   */
  const createdAt =
    options.createdAt ?? batch.approvedAt?.slice(0, 19) ?? new Date().toISOString().slice(0, 19)
  const total = batchTotal(batch)
  const count = String(batch.instructions.length)

  const writer = new XmlWriter()

  writer.open('Document', {
    xmlns: `urn:iso:std:iso:20022:tech:xsd:${version}`,
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  })
  writer.open('CstmrCdtTrfInitn')

  writer.open('GrpHdr')
  writer.leaf('MsgId', painText(batch.reference, 35))
  writer.leaf('CreDtTm', createdAt)
  writer.leaf('NbOfTxs', count)
  writer.leaf('CtrlSum', painAmount(total))
  writer.open('InitgPty')
  writer.leaf('Nm', painText(options.initiatingParty ?? batch.debtorName, 70))
  writer.close('InitgPty')
  writer.close('GrpHdr')

  /**
   * One `PmtInf` block, because every instruction in a batch shares its
   * execution date and its debtor. A batch that needed two dates would be two
   * batches, which is easier to approve and easier to explain.
   */
  writer.open('PmtInf')
  writer.leaf('PmtInfId', painText(batch.reference, 35))
  writer.leaf('PmtMtd', 'TRF')
  // False: the bank books each transfer separately, so the statement shows one
  // line per payee. Batch booking shows one line for the lot, which is exactly
  // what makes the reconciliation afterwards impossible.
  writer.leaf('BtchBookg', 'false')
  writer.leaf('NbOfTxs', count)
  writer.leaf('CtrlSum', painAmount(total))

  writer.open('PmtTpInf')
  writer.open('SvcLvl')
  writer.leaf('Cd', 'SEPA')
  writer.close('SvcLvl')
  writer.close('PmtTpInf')

  writer.leaf('ReqdExctnDt', batch.requestedExecutionDate)

  writer.open('Dbtr')
  writer.leaf('Nm', painText(batch.debtorName, 70))
  writer.close('Dbtr')

  writer.open('DbtrAcct')
  writer.open('Id')
  writer.leaf('IBAN', batch.debtorIban.replace(/\s/g, '').toUpperCase())
  writer.close('Id')
  writer.close('DbtrAcct')

  writer.open('DbtrAgt')
  writer.open('FinInstnId')
  if (batch.debtorBic === null) {
    // `NOTPROVIDED` is what the guidelines say to write when the BIC is not
    // known, and is accepted for a domestic SEPA transfer.
    writer.open('Othr')
    writer.leaf('Id', 'NOTPROVIDED')
    writer.close('Othr')
  } else {
    writer.leaf('BIC', batch.debtorBic.toUpperCase())
  }
  writer.close('FinInstnId')
  writer.close('DbtrAgt')

  // SLEV: each side pays its own bank's charges, which is the only option a
  // SEPA credit transfer allows.
  writer.leaf('ChrgBr', 'SLEV')

  for (const instruction of batch.instructions) writeInstruction(writer, instruction)

  writer.close('PmtInf')
  writer.close('CstmrCdtTrfInitn')
  writer.close('Document')

  return `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`
}
