import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatMinorUnits, parseMinorUnits, percentOf } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { capturePurchaseInvoice } from '~/server/purchase'
import { listContacts, listTaxCodes } from '~/server/sales'
import { listAccounts } from '~/server/ledger'

/**
 * Entering a supplier's invoice.
 *
 * Deliberately not the mirror of the sales form. There, you type quantities and
 * prices and the system computes the VAT. Here the document already says what
 * everything is, and the job is to get *its* figures into the system and code
 * them to accounts — so the fields are the ones printed on the paper: the
 * supplier's number, the net, the VAT and the total.
 *
 * The totals are typed rather than derived, and the form tells you when the
 * lines do not add up to them. That is not friction for its own sake: it is the
 * check that catches a line you missed, and it is the reason a captured invoice
 * can be trusted to be the document rather than somebody's summary of it.
 */
export const Route = createFileRoute('/_app/purchases/new')({
  loader: async () => ({
    contacts: await listContacts({ data: { customersOnly: false } }),
    taxCodes: await listTaxCodes(),
    accounts: await listAccounts(),
  }),
  component: NewPurchaseInvoice,
})

interface DraftLine {
  description: string
  accountNumber: string
  taxCode: string
  net: string
  tax: string
}

const emptyLine = (account: string, tax: string): DraftLine => ({
  description: '',
  accountNumber: account,
  taxCode: tax,
  net: '',
  tax: '',
})

const today = (): string => new Date().toISOString().slice(0, 10)

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function NewPurchaseInvoice() {
  const { contacts, taxCodes, accounts } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  const suppliers = contacts.ok
    ? contacts.data.contacts.filter((contact) => contact.isSupplier && !contact.isBlocked)
    : []
  // Input codes only: the VAT on a purchase invoice is ours to deduct, not to
  // charge, and offering an output code would invite a finding rather than
  // prevent one.
  const inputCodes = taxCodes.ok
    ? taxCodes.data.taxCodes.filter((code) => code.direction === 'input')
    : []
  const costAccounts = accounts.ok
    ? accounts.data.accounts.filter(
        (account) => account.type === 'expense' || account.type === 'asset',
      )
    : []

  const defaultAccount = costAccounts[0]?.number ?? ''
  /**
   * The plain voorbelasting code, not simply the first input code.
   *
   * Sorted alphabetically the first input code is an intra-community
   * acquisition, which charges no VAT — so defaulting to it makes an ordinary
   * domestic invoice unbookable the moment somebody types the VAT from the
   * document. A default that turns the commonest case into a blocking finding
   * is worse than no default.
   */
  const defaultTax =
    (
      inputCodes.find(
        (code) =>
          code.scope === 'domestic' &&
          code.reverseCharge === 'none' &&
          code.deductibility === 'full' &&
          code.rateBasisPoints > 0,
      ) ?? inputCodes[0]
    )?.code ?? ''

  const [contactNumber, setContactNumber] = useState(suppliers[0]?.number ?? '')
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [kind, setKind] = useState<'invoice' | 'credit_note'>('invoice')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [paymentReference, setPaymentReference] = useState('')
  const [statedNet, setStatedNet] = useState('')
  const [statedTax, setStatedTax] = useState('')
  const [statedTotal, setStatedTotal] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine(defaultAccount, defaultTax)])
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const key = useRef<string>(crypto.randomUUID())

  const filled = lines.filter((line) => line.description !== '' || line.net !== '')

  const lineNet = filled.reduce((sum, line) => sum + (parseMinorUnits(line.net) ?? 0n), 0n)
  const lineTax = filled.reduce((sum, line) => sum + (parseMinorUnits(line.tax) ?? 0n), 0n)
  const net = parseMinorUnits(statedNet) ?? 0n
  const tax = parseMinorUnits(statedTax) ?? 0n
  const total = parseMinorUnits(statedTotal) ?? 0n

  const netMatches = lineNet === net
  const taxMatches = lineTax === tax
  const totalMatches = net + tax === total

  function update(index: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)))
  }

  /**
   * Fills a line's VAT from its tax code, as a convenience.
   *
   * Only ever on request, never automatically: the whole point of this screen
   * is that the document's figures go in, and a field that helpfully overwrites
   * itself with our arithmetic would defeat it.
   */
  function suggestTax(index: number): void {
    const line = lines[index]
    if (line === undefined) return
    const code = inputCodes.find((entry) => entry.code === line.taxCode)
    const amount = parseMinorUnits(line.net)
    if (code === undefined || amount === null) return
    // Formatted, not `.toString()`: this field is read back with
    // `parseMinorUnits`, which reads a bare `21000` as twenty-one thousand
    // euros. Writing minor units into a field that parses human input is a
    // factor of a hundred, and a browser test is what found it.
    update(index, { tax: formatMinorUnits(percentOf(amount, code.ratePercent)) })
  }

  async function capture(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Captured before the first await: React nulls a synthetic event's
    // currentTarget once the handler returns.
    const element = event.currentTarget

    setBusy(true)
    setProblems([])

    const result = await capturePurchaseInvoice({
      data: {
        idempotencyKey: key.current,
        body: {
          contactNumber,
          supplierInvoiceNumber,
          kind,
          invoiceDate,
          dueDate,
          net: net.toString(),
          tax: tax.toString(),
          total: total.toString(),
          paymentReference: paymentReference === '' ? null : paymentReference,
          notes: null,
          lines: filled.map((line) => ({
            description: line.description,
            accountNumber: line.accountNumber,
            taxCode: line.taxCode,
            net: (parseMinorUnits(line.net) ?? 0n).toString(),
            tax: (parseMinorUnits(line.tax) ?? 0n).toString(),
          })),
        },
      },
    })
    setBusy(false)

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message)
          : [result.problem.detail],
      )
      return
    }

    key.current = crypto.randomUUID()
    element.reset()
    await navigate({ to: '/purchases/$invoiceId', params: { invoiceId: result.data.id } })
  }

  if (suppliers.length === 0) {
    return (
      <>
        <PageHeader title={t('purchaseNew.title')} />
        <p className="text-muted-foreground border-border max-w-2xl rounded-md border border-dashed p-4 text-sm">
          {t('purchaseNew.noSuppliers')}
        </p>
      </>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        void capture(event)
      }}
    >
      <PageHeader title={t('purchaseNew.title')} description={t('purchaseNew.intro')} />

      <div className="mb-6 grid max-w-5xl grid-cols-4 gap-4">
        <SelectField
          label={t('contacts.supplierLabel')}
          value={contactNumber}
          onValueChange={setContactNumber}
          disabled={!hydrated}
        >
          {suppliers.map((supplier) => (
            <SelectOption key={supplier.number} value={supplier.number}>
              {supplier.number} {supplier.name}
            </SelectOption>
          ))}
        </SelectField>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('purchaseNew.supplierInvoiceNumber')}
          </span>
          <input
            aria-label={t('purchaseNew.supplierInvoiceNumber')}
            value={supplierInvoiceNumber}
            onChange={(event) => {
              setSupplierInvoiceNumber(event.target.value)
            }}
            required
            maxLength={64}
            placeholder="F-2026-0042"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

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
            {t('purchaseNew.paymentReference')}
          </span>
          <input
            aria-label={t('purchaseNew.paymentReference')}
            value={paymentReference}
            onChange={(event) => {
              setPaymentReference(event.target.value)
            }}
            placeholder="0123456789012345"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('purchases.invoiceDate')}
          </span>
          <input
            type="date"
            aria-label={t('purchases.invoiceDate')}
            value={invoiceDate}
            onChange={(event) => {
              setInvoiceDate(event.target.value)
              setDueDate(addDays(event.target.value, 30))
            }}
            className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('purchases.dueDate')}
          </span>
          <input
            type="date"
            aria-label={t('purchases.dueDate')}
            value={dueDate}
            onChange={(event) => {
              setDueDate(event.target.value)
            }}
            className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <h2 className="mb-2 text-sm font-semibold">{t('purchaseNew.asOnDocument')}</h2>
      <div className="mb-6 grid max-w-2xl grid-cols-3 gap-4">
        {(
          [
            [t('purchaseNew.netAmount'), statedNet, setStatedNet, netMatches],
            [t('invoice.vat'), statedTax, setStatedTax, taxMatches],
            [t('report.total'), statedTotal, setStatedTotal, totalMatches],
          ] as const
        ).map(([label, value, setValue, matches]) => (
          <label key={label} className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
            <input
              aria-label={label}
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
              }}
              required
              placeholder="0,00"
              className={
                matches
                  ? 'border-input bg-background tabular w-full rounded-md border px-3 py-2 text-right text-sm'
                  : 'border-destructive bg-background tabular w-full rounded-md border px-3 py-2 text-right text-sm'
              }
            />
          </label>
        ))}
      </div>

      <table className="mb-4 w-full max-w-5xl text-sm">
        <caption className="sr-only">{t('purchaseNew.lines')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-medium">{t('entries.description')}</th>
            <th className="w-48 py-2 font-medium">{t('invoice.ledgerAccount')}</th>
            <th className="w-32 py-2 font-medium">{t('purchaseNew.taxCode')}</th>
            <th className="w-28 py-2 text-right font-medium">{t('purchaseNew.excludingVat')}</th>
            <th className="w-28 py-2 text-right font-medium">{t('invoice.vat')}</th>
            <th className="w-8 py-2" />
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
                      setLines((current) => [...current, emptyLine(defaultAccount, defaultTax)])
                    }
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                />
              </td>
              <td className="py-1">
                <SelectField
                  label={t('invoiceNew.accountLine', { line: String(index + 1) })}
                  labelHidden
                  value={line.accountNumber}
                  disabled={!hydrated}
                  onValueChange={(next) => {
                    update(index, { accountNumber: next })
                  }}
                >
                  {costAccounts.map((account) => (
                    <SelectOption key={account.number} value={account.number}>
                      {account.number} {account.name}
                    </SelectOption>
                  ))}
                </SelectField>
              </td>
              <td className="py-1">
                <SelectField
                  label={t('purchaseNew.taxCodeLine', { line: String(index + 1) })}
                  labelHidden
                  value={line.taxCode}
                  disabled={!hydrated}
                  onValueChange={(next) => {
                    update(index, { taxCode: next })
                  }}
                >
                  {inputCodes.map((code) => (
                    <SelectOption key={code.code} value={code.code}>
                      {code.code} · {code.ratePercent}% · {code.description}
                    </SelectOption>
                  ))}
                </SelectField>
              </td>
              <td className="py-1">
                <input
                  aria-label={t('purchaseNew.netLine', { line: String(index + 1) })}
                  value={line.net}
                  onChange={(event) => {
                    update(index, { net: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={t('invoiceNew.vatLine', { line: String(index + 1) })}
                  value={line.tax}
                  onChange={(event) => {
                    update(index, { tax: event.target.value })
                  }}
                  className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-right"
                />
              </td>
              <td className="py-1 text-center">
                <button
                  type="button"
                  aria-label={t('purchaseNew.computeTaxLine', { line: String(index + 1) })}
                  title={t('purchaseNew.computeTaxTitle')}
                  disabled={!hydrated}
                  onClick={() => {
                    suggestTax(index)
                  }}
                  className="text-muted-foreground text-xs underline disabled:opacity-50"
                >
                  ƒ
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-xs">
            <td colSpan={3} className="text-muted-foreground py-2">
              {t('purchaseNew.linesTogether')}
            </td>
            <td className="py-2 text-right">
              <span className={netMatches ? undefined : 'text-destructive'}>
                <Money amount={lineNet.toString()} />
              </span>
            </td>
            <td className="py-2 text-right">
              <span className={taxMatches ? undefined : 'text-destructive'}>
                <Money amount={lineTax.toString()} />
              </span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {(!netMatches || !taxMatches || !totalMatches) && (
        <ul className="text-unreconciled mb-4 max-w-2xl space-y-1 text-sm">
          {!netMatches && <li>{t('purchaseNew.netDoesNotMatch')}</li>}
          {!taxMatches && <li>{t('purchaseNew.taxDoesNotMatch')}</li>}
          {!totalMatches && <li>{t('purchaseNew.totalDoesNotMatch')}</li>}
        </ul>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-4 max-w-2xl space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={!hydrated || busy || filled.length === 0 || supplierInvoiceNumber === ''}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? t('common.busy') : t('invoiceNew.saveDraft')}
      </button>
      <p className="text-muted-foreground mt-2 max-w-2xl text-xs">{t('purchaseNew.saveNote')}</p>
    </form>
  )
}
