import { violation, LedgerError } from '../errors.js'

/**
 * What an invoice adds up to.
 *
 * Two things make this less trivial than it looks.
 *
 * **Rounding is a policy, not a detail.** Spec 6.1: "VAT may be rounded per
 * line or per invoice total. Make it a per-entity setting, default per
 * invoice." The two give different answers — three lines of 33.33 at 21% round
 * to 7.00 per line and 6.99 on the total — and an accountant will notice which
 * one you picked. Both are implemented; neither is hard-coded.
 *
 * **Nothing is a float.** Quantity is a decimal string, price is minor units,
 * and the rate is basis points. Every product is integer arithmetic with an
 * explicit half-up rounding step, because `1.15 * 100` is 114.99999999999999
 * and an invoice is a legal document.
 */

export type VatRounding = 'per_invoice' | 'per_line'

export interface TaxCodeSnapshot {
  readonly id: string
  readonly code: string
  readonly description: string
  /** 2100 is 21%. */
  readonly rateBasisPoints: number
  readonly isReverseCharge: boolean
  /** UBL category: S, Z, E, AE, K, G. */
  readonly ublCategory: string
}

export interface InvoiceLineInput {
  readonly description: string
  /** A decimal string: `1`, `2.5`, `0.25`. */
  readonly quantity: string
  readonly unitCode: string
  readonly unitPrice: bigint
  readonly revenueAccountNumber: string
  readonly taxCode: string
}

export interface PricedLine {
  readonly lineNumber: number
  readonly description: string
  readonly quantity: string
  readonly unitCode: string
  readonly unitPrice: bigint
  readonly revenueAccountNumber: string
  readonly tax: TaxCodeSnapshot
  readonly net: bigint
  /**
   * Under `per_invoice` this is the line's share of the group total, allocated
   * by largest remainder so the shares sum to the group exactly.
   */
  readonly tax_: bigint
}

/** One row of the UBL `TaxSubtotal`, and one line of the invoice's tax summary. */
export interface TaxGroup {
  readonly tax: TaxCodeSnapshot
  readonly net: bigint
  readonly amount: bigint
}

export interface PricedInvoice {
  readonly lines: readonly PricedLine[]
  readonly taxGroups: readonly TaxGroup[]
  readonly net: bigint
  readonly tax: bigint
  readonly total: bigint
  readonly rounding: VatRounding
}

const QUANTITY = /^-?\d+(\.\d+)?$/

/** A decimal string to a scaled integer, keeping the scale. */
function parseDecimal(value: string, field: string): { scaled: bigint; scale: bigint } {
  if (!QUANTITY.test(value)) {
    throw new LedgerError([violation('invalid_exchange_rate.decimal_number', field, { value })])
  }
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const scaled = BigInt(whole + fraction)
  return { scaled: negative ? -scaled : scaled, scale: 10n ** BigInt(fraction.length) }
}

/** Half-up division of integers, sign-aware. */
function divideRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const a = numerator < 0n ? -numerator : numerator
  const b = denominator < 0n ? -denominator : denominator
  const rounded = (a * 2n + b) / (b * 2n)
  return negative ? -rounded : rounded
}

/** quantity × unit price, to whole minor units, half-up. */
export function lineNet(quantity: string, unitPrice: bigint): bigint {
  const { scaled, scale } = parseDecimal(quantity, 'quantity')
  return divideRound(scaled * unitPrice, scale)
}

/** net × rate, to whole minor units, half-up. */
export function taxOn(net: bigint, rateBasisPoints: number): bigint {
  return divideRound(net * BigInt(rateBasisPoints), 10_000n)
}

/**
 * Split a group's tax back over its lines so the parts sum to the whole.
 *
 * Needed only under `per_invoice`, where the authoritative figure is the group
 * total and the per-line numbers are a presentation of it. Largest remainder,
 * ties to the earlier line, so the result is deterministic.
 */
function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n)
  if (weightTotal === 0n) return weights.map(() => 0n)

  const shares: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let allocated = 0n

  weights.forEach((weight, index) => {
    const exact = total * weight
    const share = exact / weightTotal
    shares.push(share)
    allocated += share
    remainders.push({ index, remainder: exact % weightTotal })
  })

  let leftover = total - allocated
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index
    return a.remainder > b.remainder ? -1 : 1
  })

  const step = leftover < 0n ? -1n : 1n
  for (const entry of remainders) {
    if (leftover === 0n) break
    shares[entry.index] = shares[entry.index]! + step
    leftover -= step
  }

  return shares
}

export function priceInvoice(
  lines: readonly InvoiceLineInput[],
  taxCodes: ReadonlyMap<string, TaxCodeSnapshot>,
  rounding: VatRounding,
): PricedInvoice {
  if (lines.length === 0) {
    throw new LedgerError([violation('entry_too_few_lines.invoice_line', 'lines')])
  }

  const resolved = lines.map((line, index) => {
    const tax = taxCodes.get(line.taxCode)
    if (tax === undefined) {
      throw new LedgerError([
        violation('unknown_account.tax_code', `lines.${String(index)}.taxCode`, {
          taxCode: line.taxCode,
        }),
      ])
    }
    return { line, tax, index, net: lineNet(line.quantity, line.unitPrice) }
  })

  // Group by tax code. This is what UBL reports and what the ledger posts.
  const groups = new Map<string, { tax: TaxCodeSnapshot; members: typeof resolved }>()
  for (const item of resolved) {
    const group = groups.get(item.tax.code) ?? { tax: item.tax, members: [] }
    group.members.push(item)
    groups.set(item.tax.code, group)
  }

  const lineTax = new Map<number, bigint>()
  const taxGroups: TaxGroup[] = []

  for (const group of groups.values()) {
    const groupNet = group.members.reduce((sum, member) => sum + member.net, 0n)

    if (rounding === 'per_line') {
      let groupTax = 0n
      for (const member of group.members) {
        const amount = taxOn(member.net, group.tax.rateBasisPoints)
        lineTax.set(member.index, amount)
        groupTax += amount
      }
      taxGroups.push({ tax: group.tax, net: groupNet, amount: groupTax })
      continue
    }

    // per_invoice: the group total is authoritative, the lines are its shares.
    const groupTax = taxOn(groupNet, group.tax.rateBasisPoints)
    const shares = allocate(
      groupTax,
      group.members.map((member) => member.net),
    )
    group.members.forEach((member, position) => {
      lineTax.set(member.index, shares[position]!)
    })
    taxGroups.push({ tax: group.tax, net: groupNet, amount: groupTax })
  }

  taxGroups.sort((a, b) => a.tax.code.localeCompare(b.tax.code))

  const priced: PricedLine[] = resolved.map((item) => ({
    lineNumber: item.index + 1,
    description: item.line.description,
    quantity: item.line.quantity,
    unitCode: item.line.unitCode,
    unitPrice: item.line.unitPrice,
    revenueAccountNumber: item.line.revenueAccountNumber,
    tax: item.tax,
    net: item.net,
    tax_: lineTax.get(item.index) ?? 0n,
  }))

  const net = priced.reduce((sum, line) => sum + line.net, 0n)
  const tax = taxGroups.reduce((sum, group) => sum + group.amount, 0n)

  return { lines: priced, taxGroups, net, tax, total: net + tax, rounding }
}

/** issueDate plus the contact's payment terms. */
export function dueDate(issueDate: string, paymentTermsDays: number): string {
  const date = new Date(`${issueDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + paymentTermsDays)
  return date.toISOString().slice(0, 10)
}
