import { cn } from '~/lib/utils'
import { formatMinorUnits, type MoneyFormat, DEFAULT_MONEY_FORMAT } from '~/lib/format'

/**
 * Every figure in the application (spec 11.3).
 *
 * "Numbers are tabular-figure, right-aligned, and negative is unambiguous. Pick
 * one convention, make it a setting, apply it in one component."
 *
 * This is that component. Amounts arrive as minor-unit strings from the API and
 * are parsed to `bigint` here — the value never becomes a `Number`, not even to
 * display it.
 */
export function Money({
  amount,
  format = DEFAULT_MONEY_FORMAT,
  className,
  muteZero = false,
}: {
  /** Minor units, as the API sends them. */
  amount: string | bigint
  format?: MoneyFormat | undefined
  className?: string | undefined
  muteZero?: boolean | undefined
}) {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount)
  const rendered = formatMinorUnits(value, format)

  return (
    <span
      className={cn(
        'tabular text-right',
        value < 0n && 'text-amount-negative',
        muteZero && value === 0n && 'text-muted-foreground',
        className,
      )}
      // The exact minor-unit value, for anyone copying out of the DOM.
      data-minor-units={value.toString()}
    >
      {rendered}
    </span>
  )
}

/** A debit/credit pair, the way a ledger column reads: one side or the other. */
export function DebitCredit({ debit, credit }: { debit: string; credit: string }) {
  return (
    <>
      <td className="px-3 py-1 text-right">
        <Money amount={debit} format={{ negative: 'minus', showZero: false }} />
      </td>
      <td className="px-3 py-1 text-right">
        <Money amount={credit} format={{ negative: 'minus', showZero: false }} />
      </td>
    </>
  )
}
