import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { AccountPicker } from '~/components/finance/account-picker'
import { ShortcutFooter, ShortcutPanel, StepBadge } from '~/components/ui/keycap'
import { useT } from '~/i18n/provider'
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
  /** Whether the draft has been described, so Escape knows what it would lose. */
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)

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
              message: violationMessage(t, violation),
            }))
          : [{ path: null, message: result.problem.detail }],
      )
      return
    }

    idempotencyKey.current = crypto.randomUUID()
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: result.data.id } })
  }

  const typed =
    contactNumber !== '' || lines.some((line) => line.description !== '' || line.unitPrice !== '')

  /**
   * Say what will be saved before saving it.
   *
   * A draft is not the ledger, so this is a smaller promise than the journaalpost
   * confirmation — but `Cmd`+`Enter` is a key that writes to the server, and a
   * key that writes without showing what it writes is the thing the keyboard map
   * refuses. Same shape as the entry form, so the spine is one habit.
   */
  function ask(): void {
    if (busy) return
    if (!typed) {
      setProblems([{ path: null, message: t('invoiceNew.nothingYet') }])
      return
    }
    setProblems([])
    setLeaving(false)
    setConfirming(true)
  }

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const { t } = useT()

  return (
    <form
      className="xl:pr-72"
      onKeyDown={(event) => {
        const mod = isApple() ? event.metaKey : event.ctrlKey
        if (mod && event.key === 'Enter') {
          event.preventDefault()
          if (event.repeat) return
          if (confirming) void submit()
          else ask()
          return
        }
        if (event.key === 'Enter' && !mod) {
          // "Enter on primary save, not mid-field": a form that submits from the
          // middle of an amount is a form that saves what somebody was still
          // typing. On the button itself this handler never sees it — the button
          // does.
          const target = event.target as HTMLElement | null
          if (target !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
            event.preventDefault()
          }
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          if (confirming) {
            setConfirming(false)
            return
          }
          // An untouched form leaves at once. A draft with something in it takes
          // two presses, and says so in between: Escape abandons the thing you
          // are in, and it should not be able to throw away typing by surprise.
          if (!typed || leaving) {
            void navigate({ to: '/invoices', search: { status: undefined } })
            return
          }
          setLeaving(true)
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        // A click on the button labelled "Concept opslaan" is the confirmation.
        // What asks first is the keystroke, below: a key that writes without
        // showing what it writes is the thing the keyboard map refuses, and a
        // draft is not the ledger, so the button does not ask twice.
        void submit()
      }}
    >
      <PageHeader title={t('invoices.new')} description={t('invoiceNew.intro')} />

      {customers.length === 0 && (
        <p className="border-border text-muted-foreground mb-6 border border-dashed p-4 text-sm">
          {t('invoiceNew.noCustomers')}
        </p>
      )}

      <div className="mb-2">
        <StepBadge step={2}>{t('invoices.stepForm')}</StepBadge>
      </div>

      <div className="mb-6 grid max-w-5xl grid-cols-5 gap-4">
        <SelectField
          label={t('invoiceNew.customer')}
          value={contactNumber}
          onValueChange={setContactNumber}
          disabled={!hydrated}
        >
          {customers.map((customer) => (
            <SelectOption key={customer.number} value={customer.number}>
              {customer.number} · {customer.name}
            </SelectOption>
          ))}
        </SelectField>

        <SelectField
          label={t('invoices.kind')}
          value={kind}
          disabled={!hydrated}
          onValueChange={(next) => {
            setKind(next === 'credit_note' ? 'credit_note' : 'invoice')
          }}
        >
          <SelectOption value="invoice">{t('invoice.title')}</SelectOption>
          <SelectOption value="credit_note">{t('invoice.creditNote')}</SelectOption>
        </SelectField>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('invoiceNew.issueDate')}
          </span>
          <input
            type="date"
            value={issueDate}
            onChange={(event) => {
              setIssueDate(event.target.value)
            }}
            className="border-input bg-background tabular w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('invoiceNew.buyerReference')}
          </span>
          <input
            value={buyerReference}
            onChange={(event) => {
              setBuyerReference(event.target.value)
            }}
            placeholder={t('invoiceNew.buyerReferencePlaceholder')}
            className="border-input bg-background w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('invoiceNew.purchaseOrder')}
          </span>
          <input
            value={reference}
            onChange={(event) => {
              setReference(event.target.value)
            }}
            placeholder="PO-1234"
            className="border-input bg-background w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-muted-foreground mb-6 max-w-3xl text-xs">
        {t('invoiceNew.referenceNote')}
      </p>

      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-medium">{t('entries.description')}</th>
            <th className="w-24 py-2 font-medium">{t('invoice.quantity')}</th>
            <th className="w-20 py-2 font-medium">{t('invoiceNew.unit')}</th>
            <th className="w-32 py-2 pr-3 text-right font-medium">{t('invoice.price')}</th>
            <th className="w-40 py-2 font-medium">{t('invoice.ledgerAccount')}</th>
            <th className="w-28 py-2 font-medium">{t('invoice.vat')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index} className="border-border border-b">
              <td className="py-1">
                <input
                  aria-label={t('entryNew.descriptionLine', { line: String(index + 1) })}
                  value={line.description}
                  onChange={(event) => {
                    update(index, { description: event.target.value })
                    if (index === lines.length - 1 && event.target.value !== '') {
                      setLines((current) => [...current, emptyLine(defaultRevenue, defaultTax)])
                    }
                  }}
                  className="border-input bg-background w-full border px-2 py-1.5"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={t('invoiceNew.quantityLine', { line: String(index + 1) })}
                  value={line.quantity}
                  onChange={(event) => {
                    update(index, { quantity: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={t('invoiceNew.unitLine', { line: String(index + 1) })}
                  value={line.unitCode}
                  onChange={(event) => {
                    update(index, { unitCode: event.target.value })
                  }}
                  className="border-input bg-background w-full border px-2 py-1.5"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={t('invoiceNew.priceLine', { line: String(index + 1) })}
                  value={line.unitPrice}
                  onChange={(event) => {
                    update(index, { unitPrice: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1">
                <AccountPicker
                  label={t('invoiceNew.accountLine', { line: String(index + 1) })}
                  labelHidden
                  accounts={revenueAccounts}
                  value={line.revenueAccountNumber}
                  disabled={!hydrated}
                  onValueChange={(next) => {
                    update(index, { revenueAccountNumber: next })
                  }}
                />
              </td>
              <td className="py-1">
                <SelectField
                  label={t('invoiceNew.vatLine', { line: String(index + 1) })}
                  labelHidden
                  value={line.taxCode}
                  disabled={!hydrated}
                  onValueChange={(next) => {
                    update(index, { taxCode: next })
                  }}
                >
                  {codes.map((code) => (
                    <SelectOption key={code.code} value={code.code}>
                      {code.code} · {code.ratePercent}%
                    </SelectOption>
                  ))}
                </SelectField>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-border mb-6 flex max-w-md justify-between gap-8 border p-4 text-sm">
        <div className="space-y-1">
          <p className="text-muted-foreground">{t('invoice.subtotal')}</p>
          <p className="text-muted-foreground">{t('invoice.vat')}</p>
          <p className="font-medium">{t('report.total')}</p>
        </div>
        <div className="space-y-1 text-right">
          <Money amount={net} className="block" />
          <Money amount={tax} className="block" />
          <Money amount={net + tax} className="block font-medium" />
        </div>
      </div>
      <p className="text-muted-foreground mb-6 max-w-md text-xs">{t('invoiceNew.vatNote')}</p>

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

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('invoiceNew.confirmTitle')}
          className="border-border mb-6 border p-4"
        >
          <h2 className="font-medium">{t('invoiceNew.confirmTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('invoiceNew.confirmBody', {
              customer: contactNumber,
              lines: String(lines.filter((line) => line.description !== '').length),
            })}{' '}
            <Money amount={net + tax} />
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              ref={confirmRef}
              disabled={busy}
              onClick={() => {
                void submit()
              }}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('invoiceNew.confirmSave')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
              }}
              className="border-input border px-4 py-2 text-sm font-medium"
            >
              {t('entryNew.confirmBack')}
            </button>
          </div>
        </div>
      )}

      {leaving && !confirming && (
        <p role="status" className="text-unreconciled mb-6 text-sm">
          {t('invoiceNew.escapeAgain')}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !hydrated || contactNumber === ''}
          className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('invoiceNew.saveDraft')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void navigate({ to: '/invoices', search: { status: undefined } })
          }}
          className="border-input border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <span className="text-muted-foreground text-xs">{t('invoiceNew.emptyLinesSkipped')}</span>
      </div>

      {/* Only what this form answers to: `j` is a letter here, not a cursor. */}
      <ShortcutFooter ids={['invoiceForm.save', 'invoiceForm.cancel']} />

      <ShortcutPanel
        ids={['invoiceForm.save', 'invoiceForm.cancel', 'picker.choose', 'picker.next']}
      />
    </form>
  )
}
