import { Badge } from '~/components/ui/badge'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import type { InvoicePill } from '~/lib/sales-list'

/**
 * Status pills for Sales list / preview (#107 Phase 2).
 *
 * Overdue uses the danger/late pill with “… dagen te laat” (`_one`/`_other`).
 * Open → info. Draft / cancelled / credit note → neutral. No Paid pill ([API]).
 */

const VARIANT: Record<
  NonNullable<InvoicePill['kind']>,
  'info' | 'destructive' | 'secondary' | 'default'
> = {
  open: 'info',
  overdue: 'destructive',
  draft: 'secondary',
  cancelled: 'default',
  credit_note: 'default',
}

export function InvoiceStatusPill({ pill }: { readonly pill: InvoicePill }) {
  const { t, plural } = useT()
  if (pill.kind === null) return null

  let label: string
  if (pill.kind === 'overdue') {
    if (pill.daysOverdue === null) return null
    label = plural('sales.pill.daysLate', pill.daysOverdue, {
      days: String(pill.daysOverdue),
    })
  } else {
    const key = `sales.pill.${pill.kind}` as MessageKey
    label = t(key)
  }

  return <Badge variant={VARIANT[pill.kind]}>{label}</Badge>
}
