import { createFileRoute, notFound } from '@tanstack/react-router'
import { GuidedInvoiceFlow } from '~/components/invoices/guided-invoice-flow'

/**
 * Guided invoice lab (redesign slice 5 / #61).
 *
 * Dev-only fixture surface for empty / loading / error chrome and Playwright
 * screenshots under the real `_app` shell. Production builds 404.
 *
 * Query: `?state=empty|loading|error`
 */
export const Route = createFileRoute('/_app/lab/guided-invoice')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  validateSearch: (search: Record<string, unknown>) => ({
    state:
      search['state'] === 'empty' || search['state'] === 'loading' || search['state'] === 'error'
        ? search['state']
        : ('empty' as const),
  }),
  component: GuidedInvoiceLab,
})

function GuidedInvoiceLab() {
  const { state } = Route.useSearch()

  if (state === 'loading') {
    return (
      <GuidedInvoiceFlow
        customers={[]}
        taxCodes={[]}
        accounts={[]}
        entity={null}
        initialPhase="loading"
      />
    )
  }

  if (state === 'error') {
    return (
      <GuidedInvoiceFlow
        customers={[]}
        taxCodes={[]}
        accounts={[]}
        entity={null}
        contactsError="De klantenlijst kon niet worden geladen. Probeer het opnieuw."
        initialPhase="error"
      />
    )
  }

  return (
    <GuidedInvoiceFlow
      customers={[]}
      taxCodes={[]}
      accounts={[]}
      entity={null}
      initialPhase="form"
    />
  )
}
