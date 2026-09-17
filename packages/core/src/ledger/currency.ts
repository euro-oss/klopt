import type { CurrencyCode } from '../money.js'

/**
 * Converting a foreign-currency entry into the functional currency.
 *
 * The naive approach — convert each line independently — does not work, and it
 * fails silently. Take three USD debits of 3.33, 3.33 and 3.34 against one
 * credit of 10.00, at a rate of 0.335. Converted line by line the debits round
 * to 1.12 + 1.12 + 1.12 = 3.36, while the credit rounds to 3.35. The entry
 * balances perfectly in USD and is a cent out in EUR, so the database's balance
 * trigger rejects it — and the user gets an error about an entry they typed in
 * correctly.
 *
 * So the conversion is done per side, on the total, and the result is
 * distributed back over the lines by largest remainder. The functional totals
 * of the two sides are then equal by construction, because the original totals
 * were equal and the rate is the same.
 *
 * When lines in one currency carry *different* rates, that is not a rounding
 * artefact — it is a realised exchange result, a real economic event with a
 * real amount. Those are converted per line and any residual is reported, so
 * the user posts it to a koersverschil account themselves. Spec 6.1: every
 * rounding difference has a destination account, and nothing is silently
 * absorbed.
 */

export interface ConvertibleLine {
  readonly lineNumber: number
  readonly currency: CurrencyCode
  readonly debit: bigint
  readonly credit: bigint
  /** Null for lines already in the functional currency. */
  readonly exchangeRate: string | null
}

export interface ConvertedAmounts {
  readonly functionalDebit: bigint
  readonly functionalCredit: bigint
}

/** Half-up, in integers. A float here would defeat the entire exercise. */
export function multiplyByRate(amount: bigint, rate: string): bigint {
  const { scaled, scale } = parseRate(rate)
  const product = amount * scaled
  const negative = product < 0n
  const magnitude = negative ? -product : product
  const rounded = (magnitude * 2n + scale) / (scale * 2n)
  return negative ? -rounded : rounded
}

function parseRate(rate: string): { scaled: bigint; scale: bigint } {
  const [whole = '0', fraction = ''] = rate.split('.')
  return { scaled: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) }
}

/**
 * Split `total` across `amounts` in proportion, giving the leftover units to
 * the largest fractional remainders. Ties break towards the earlier line, so
 * the result is deterministic and therefore hashable.
 */
function distribute(amounts: readonly bigint[], total: bigint, rate: string): bigint[] {
  const { scaled, scale } = parseRate(rate)

  const floors: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let allocated = 0n

  amounts.forEach((amount, index) => {
    const product = amount * scaled
    const floor = product / scale
    floors.push(floor)
    allocated += floor
    remainders.push({ index, remainder: product % scale })
  })

  let leftover = total - allocated
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index
    return a.remainder > b.remainder ? -1 : 1
  })

  for (const entry of remainders) {
    if (leftover <= 0n) break
    floors[entry.index] = floors[entry.index]! + 1n
    leftover -= 1n
  }

  return floors
}

/**
 * Functional amounts for every line, indexed the same way as the input.
 *
 * `residual` is what could not be made to balance: zero for the ordinary case,
 * non-zero only when one currency carries more than one rate.
 */
export function convertToFunctional(lines: readonly ConvertibleLine[]): {
  readonly amounts: readonly ConvertedAmounts[]
  readonly residual: bigint
} {
  const amounts: ConvertedAmounts[] = lines.map((line) => ({
    functionalDebit: line.exchangeRate === null ? line.debit : 0n,
    functionalCredit: line.exchangeRate === null ? line.credit : 0n,
  }))

  const byCurrency = new Map<CurrencyCode, number[]>()
  lines.forEach((line, index) => {
    if (line.exchangeRate === null) return
    const list = byCurrency.get(line.currency) ?? []
    list.push(index)
    byCurrency.set(line.currency, list)
  })

  for (const indices of byCurrency.values()) {
    const rates = new Set(indices.map((index) => lines[index]!.exchangeRate))

    if (rates.size > 1) {
      // A realised exchange result. Convert honestly, line by line, and let the
      // residual surface rather than smearing it across the lines.
      for (const index of indices) {
        const line = lines[index]!
        amounts[index] = {
          functionalDebit: multiplyByRate(line.debit, line.exchangeRate!),
          functionalCredit: multiplyByRate(line.credit, line.exchangeRate!),
        }
      }
      continue
    }

    const rate = [...rates][0]!
    for (const side of ['debit', 'credit'] as const) {
      const sideIndices = indices.filter((index) => lines[index]![side] > 0n)
      if (sideIndices.length === 0) continue

      const sideAmounts = sideIndices.map((index) => lines[index]![side])
      const total = multiplyByRate(
        sideAmounts.reduce((sum, amount) => sum + amount, 0n),
        rate,
      )
      const allocated = distribute(sideAmounts, total, rate)

      sideIndices.forEach((index, position) => {
        const value = allocated[position]!
        amounts[index] =
          side === 'debit'
            ? { functionalDebit: value, functionalCredit: amounts[index]!.functionalCredit }
            : { functionalDebit: amounts[index]!.functionalDebit, functionalCredit: value }
      })
    }
  }

  const residual = amounts.reduce(
    (total, amount) => total + amount.functionalDebit - amount.functionalCredit,
    0n,
  )

  return { amounts, residual }
}
