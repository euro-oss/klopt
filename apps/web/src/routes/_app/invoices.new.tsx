import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { multiplyByDecimal, parseMinorUnits, percentOf } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import { draftInvoice, listContacts, listTaxCodes } from '~/server/sales'
import { listAccounts } from '~/server/ledger'

/**
 * A new sales invoice.
 *
 * Drafted, not issued: drafting allocates no number and posts nothing, so it is
 * cheap and reversible. Issuing is a separate, deliberate act on the invoice's
 * own screen, because it takes a number out of a legally gapless series and
 * puts an entry in the hash chain.
 *
 * The totals shown here are computed in the browser for feedback only. The
 * authoritative figures come back from `priceInvoice` in `@klopt/core`, which
 * applies the entity's VAT rounding policy — and per-invoice rounding can
 * differ from the naive per-line sum by a cent, which is exactly the sort of
 * disagreement a bookkeeper notices. Hence the note under the total.
 */
export const Route = createFileRoute('/_app/invoices/new')({
  loader: async () => ({
    contacts: await listContacts({ data: { customersOnly: true } }),
    taxCodes: await listTaxCodes(),
    accounts: await listAccounts(),
  }),
  component: NewInvoice,
})

interface DraftLine {
  description: string
  quantity: string
  unitCode: string
  unitPrice: string
  revenueAccountNumber: string
  taxCode: string
}

const emptyLine = (revenue: string, tax: string): DraftLine => ({
  description: '',
  quantity: '1',
  unitCode: 'EA',
  unitPrice: '',
  revenueAccountNumber: revenue,
  taxCode: tax,
})

const today = (): string => new Date().toISOString().slice(0, 10)

function NewInvoice() {
  const { contacts, taxCodes, accounts } = Route.useLoaderData()
  const navigate = useNavigate()
  /**
   * Every control on this form is React-controlled, so before hydration the
   * fields accept typing that is then discarded and the submit falls back to a
   * native form POST that reloads the page. Gating the button is what makes the
   * form either work or visibly not work, rather than half-work.
   */
  const hydrated = useHydrated()

  const customers = contacts.ok ? contacts.data.contacts.filter((row) => !row.isBlocked) : []
  const codes = taxCodes.ok
    ? taxCodes.data.taxCodes.filter((code) => code.direction === 'output')
    : []
  const revenueAccounts = accounts.ok
    ? accounts.data.accounts.filter((account) => account.type === 'revenue')
    : []

  const defaultRevenue = revenueAccounts[0]?.number ?? ''
  /**
   * The highest output rate, not the alphabetically first code.
   *
   * The shipped chart's output codes sort to `GEEN` — exempt — which would make
   * every new line zero-rated by default and produce an invoice with no VAT on
   * it that nobody noticed. The commonest Dutch invoice is 21%, so the default
   * is the highest rate there is.
   */
  const defaultTax = [...codes].sort((a, b) => b.rateBasisPoints - a.rateBasisPoints)[0]?.code ?? ''

  const [contactNumber, setContactNumber] = useState(customers[0]?.number ?? '')
  const [kind, setKind] = useState<'invoice' | 'credit_note'>('invoice')
  const [issueDate, setIssueDate] = useState(today())
  const [reference, setReference] = useState('')
  const [buyerReference, setBuyerReference] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(defaultRevenue, defaultTax)])
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])

  /** One key per attempt. A second click must not draft a second invoice. */
  const idempotencyKey = useRef<string>(crypto.randomUUID())

  const update = useCallback((index: number, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    )
  }, [])

  const rateOf = (code: string): string =>
    codes.find((item) => item.code === code)?.ratePercent ?? '0'

  // Integer arithmetic, like everywhere else. The server still re-prices with
  // the entity's rounding policy, and that answer is the one that counts.
  let net = 0n
  let tax = 0n
  for (const line of lines) {
    const lineNet = multiplyByDecimal(
      parseMinorUnits(line.unitPrice) ?? 0n,
      line.quantity === '' ? '0' : line.quantity,
    )
    net += lineNet
    tax += percentOf(lineNet, rateOf(line.taxCode))
  }

  async function submit() {
    setBusy(true)
    setProblems([])

    const result = await draftInvoice({
      data: {
        idempotencyKey: idempotencyKey.current,
        contactNumber,
        kind,
        issueDate,
        reference: reference === '' ? null : reference,
        buyerReference: buyerReference === '' ? null : buyerReference,
        lines: lines
          .filter((line) => line.description !== '')
          .map((line) => ({
            description: line.description,
            quantity: line.quantity === '' ? '1' : line.quantity,
            unitCode: line.unitCode === '' ? 'EA' : line.unitCode,
            unitPrice: (parseMinorUnits(line.unitPrice) ?? 0n).toString(),
            revenueAccountNumber: line.revenueAccountNumber,
            taxCode: line.taxCode,
          })),
      },
    })

    setBusy(false)

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((violation) => ({
              path: violation.path,
              message: violation.message,
            }))
          : [{ path: null, message: result.problem.detail }],
      )
      return
    }

    idempotencyKey.current = crypto.randomUUID()
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: result.data.id } })
  }

  const modLabel = isApple() ? '⌘' : 'Ctrl'

  return (
    <form
      onKeyDown={(event) => {
        const mod = isApple() ? event.metaKey : event.ctrlKey
        if (mod && event.key === 'Enter') {
          event.preventDefault()
          void submit()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <PageHeader
        title="Nieuwe factuur"
        description={`${modLabel}+↵ maakt het concept. Versturen is een aparte stap.`}
      />

      {customers.length === 0 && (
        <p className="border-border text-muted-foreground mb-6 rounded-md border border-dashed p-4 text-sm">
          Er zijn nog geen klanten. Maak eerst een relatie aan onder Relaties.
        </p>
      )}

      <div className="mb-6 grid max-w-5xl grid-cols-5 gap-4">
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Klant</span>
          <select
            aria-label="Klant"
            value={contactNumber}
            onChange={(event) => {
              setContactNumber(event.target.value)
            }}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {customers.map((customer) => (
              <option key={customer.number} value={customer.number}>
                {customer.number} · {customer.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Soort</span>
          <select
            aria-label="Soort"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value === 'credit_note' ? 'credit_note' : 'invoice')
            }}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="invoice">Factuur</option>
            <option value="credit_note">Creditnota</option>
          </select>
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Factuurdatum</span>
          <input
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value)
            }}
            className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Referentie klant
          </span>
          <input
            value={buyerReference}
            onChange={(event) => {
              setBuyerReference(event.target.value)
            }}
            placeholder="Kostenplaats"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Inkoopnummer</span>
          <input
            value={reference}
            onChange={(event) => {
              setReference(event.target.value)
            }}
            placeholder="PO-1234"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-muted-foreground mb-6 max-w-3xl text-xs">
        Een e-factuur heeft een van beide referenties nodig — Peppol weigert een factuur zonder
        (PEPPOL-EN16931-R003). Welke van de twee maakt niet uit.
      </p>

      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-medium">Omschrijving</th>
            <th className="w-24 py-2 font-medium">Aantal</th>
            <th className="w-20 py-2 font-medium">Eenheid</th>
            <th className="w-32 py-2 text-right font-medium">Prijs</th>
            <th className="w-40 py-2 font-medium">Grootboek</th>
            <th className="w-28 py-2 font-medium">Btw</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index} className="border-border border-b">
              <td className="py-1">
                <input
                  aria-label={`Omschrijving regel ${String(index + 1)}`}
                  value={line.description}
                  onChange={(event) => {
                    update(index, { description: event.target.value })
                    if (index === lines.length - 1 && event.target.value !== '') {
                      setLines((current) => [...current, emptyLine(defaultRevenue, defaultTax)])
                    }
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={`Aantal regel ${String(index + 1)}`}
                  value={line.quantity}
                  onChange={(event) => {
                    update(index, { quantity: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={`Eenheid regel ${String(index + 1)}`}
                  value={line.unitCode}
                  onChange={(event) => {
                    update(index, { unitCode: event.target.value })
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={`Prijs regel ${String(index + 1)}`}
                  value={line.unitPrice}
                  onChange={(event) => {
                    update(index, { unitPrice: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1">
                <select
                  aria-label={`Grootboek regel ${String(index + 1)}`}
                  value={line.revenueAccountNumber}
                  onChange={(event) => {
                    update(index, { revenueAccountNumber: event.target.value })
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                >
                  {revenueAccounts.map((account) => (
                    <option key={account.number} value={account.number}>
                      {account.number} {account.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1">
                <select
                  aria-label={`Btw regel ${String(index + 1)}`}
                  value={line.taxCode}
                  onChange={(event) => {
                    update(index, { taxCode: event.target.value })
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                >
                  {codes.map((code) => (
                    <option key={code.code} value={code.code}>
                      {code.code} · {code.ratePercent}%
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-border mb-6 flex max-w-md justify-between gap-8 rounded-md border p-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">Subtotaal</p>
          <p className="text-muted-foreground">Btw</p>
          <p className="font-medium">Totaal</p>
        </div>
        <div className="space-y-1 text-right">
          <Money amount={net} className="block" />
          <Money amount={tax} className="block" />
          <Money amount={net + tax} className="block font-medium" />
        </div>
      </div>
      <p className="text-muted-foreground mb-6 max-w-md text-xs">
        Indicatief. De definitieve btw wordt op de server berekend volgens de afrondingsinstelling
        van deze administratie, en kan een cent afwijken.
      </p>

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-6 space-y-1 text-sm">
          {problems.map((problem, index) => (
            <li key={index}>
              {problem.path === null ? '' : `${problem.path}: `}
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !hydrated || contactNumber === ''}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Bezig…' : 'Concept opslaan'}
        </button>
        <span className="text-muted-foreground text-xs">
          Regels zonder omschrijving worden overgeslagen.
        </span>
      </div>
    </form>
  )
}
