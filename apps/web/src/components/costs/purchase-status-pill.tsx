import { Badge } from '~/components/ui/badge'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import type { CostsPill } from '~/lib/costs-list'

/**
 * Status pills for Costs list / preview (#107 Phase 4 / #128).
 *
 * Export StatusPill colours only: paid → success, late → destructive,
 * open → info, draft → secondary. Booked / disputed / cancelled / credit note
 * reuse those variants — no new hues.
 */

const VARIANT: Record<
  NonNullable<CostsPill['kind']>,
  'success' | 'destructive' | 'info' | 'secondary' | 'default' | 'attention'
> = {
  paid: 'success',
  overdue: 'destructive',
  open: 'info',
  draft: 'secondary',
  booked: 'attention',
  disputed: 'destructive',
  cancelled: 'default',
  credit_note: 'default',
}

export function PurchaseStatusPill({
  pill,
  /** Preview header uses the longer “past due” wording from the board. */
  overdueTone = 'list',
}: {
  readonly pill: CostsPill
  readonly overdueTone?: 'list' | 'preview'
}) {
  const { t, plural } = useT()
  if (pill.kind === null) return null

  let label: string
  if (pill.kind === 'overdue') {
    if (pill.daysOverdue === null) return null
    const key = overdueTone === 'preview' ? 'costs.pill.daysPastDue' : 'costs.pill.daysLate'
    label = plural(key, pill.daysOverdue, {
      days: String(pill.daysOverdue),
    })
  } else {
    const key = `costs.pill.${pill.kind}` as MessageKey
    label = t(key)
  }

  return <Badge variant={VARIANT[pill.kind]}>{label}</Badge>
}
