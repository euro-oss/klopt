import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { AccountPicker } from '~/components/finance/account-picker'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { DropZone } from '~/components/ui/drop-zone'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { violationMessage } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import { todayInAmsterdam } from '~/lib/amsterdam-date'
import {
  clearedTaxCodeLineNumbers,
  defaultPurchaseBookingTaxCode,
  purchaseBookingTaxCodes,
} from '~/lib/booking-tax-codes'
import { formatMinorUnits, parseMinorUnits, percentOf } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple, isTypingInto } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { receiveDocument } from '~/server/inbox'
import { listAccounts } from '~/server/ledger'
import { bookPurchaseInvoice, capturePurchaseInvoice } from '~/server/purchase'
import { listContacts, listTaxCodes } from '~/server/sales'

/**
 * BillNew — enter a supplier bill (#107 Phase 4 / #128).
 *
 * Board: BillNew.dc.html at fa4093b. Copy the document’s figures; Klopt checks
 * sums and never recalculates. Drop uses the inbox receive path; when a
 * documentId comes back it stays on this bill (preview, no Postvak copy, no
 * second upload — Legal: the copy must be true). ⌘S saves a draft; ⌘↵ books.
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

const today = (): string => todayInAmsterdam()

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function NewPurchaseInvoice() {
  const { contacts, taxCodes, accounts } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t, plural } = useT()
  const modLabel = hydrated && isApple() ? '⌘' : 'Ctrl'

  const suppliers = contacts.ok
    ? contacts.data.contacts.filter((contact) => contact.isSupplier && !contact.isBlocked)
    : []
  const costAccounts = accounts.ok
    ? accounts.data.accounts.filter(
        (account) => account.type === 'expense' || account.type === 'asset',
      )
    : []

  const defaultAccount = costAccounts[0]?.number ?? ''
  const [contactNumber, setContactNumber] = useState(suppliers[0]?.number ?? '')
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [kind, setKind] = useState<'invoice' | 'credit_note'>('invoice')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const inputCodes = useMemo(
    () => (taxCodes.ok ? purchaseBookingTaxCodes(taxCodes.data.taxCodes, invoiceDate) : []),
    [taxCodes, invoiceDate],
  )
  const defaultTax = defaultPurchaseBookingTaxCode(inputCodes)
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [paymentReference, setPaymentReference] = useState('')
  const [statedNet, setStatedNet] = useState('')
  const [statedTax, setStatedTax] = useState('')
  const [statedTotal, setStatedTotal] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine(defaultAccount, defaultTax)])
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [dateNotice, setDateNotice] = useState<string | null>(null)
  const [dropNote, setDropNote] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [attachedDocument, setAttachedDocument] = useState<{
    id: string
    filename: string
  } | null>(null)
  const key = useRef<string>(crypto.randomUUID())
  const dropKey = useRef<string>(crypto.randomUUID())

  const selectedSupplier = suppliers.find((row) => row.number === contactNumber) ?? null

  function changeInvoiceDate(next: string): void {
    setInvoiceDate(next)
    const allowed = new Set(
      (taxCodes.ok ? purchaseBookingTaxCodes(taxCodes.data.taxCodes, next) : []).map(
        (code) => code.code,
      ),
    )
    const cleared = clearedTaxCodeLineNumbers(lines, allowed)
    setDateNotice(
      cleared[0] === undefined ? null : t('booking.taxCodeInvalidOnDate', { n: cleared[0] }),
    )
    setLines((current) =>
      current.map((line) =>
        line.taxCode === '' || allowed.has(line.taxCode) ? line : { ...line, taxCode: '' },
      ),
    )
  }

  const filled = lines.filter((line) => line.description !== '' || line.net !== '')
  const lineNet = filled.reduce((sum, line) => sum + (parseMinorUnits(line.net) ?? 0n), 0n)
  const lineTax = filled.reduce((sum, line) => sum + (parseMinorUnits(line.tax) ?? 0n), 0n)
  const net = parseMinorUnits(statedNet) ?? 0n
  const tax = parseMinorUnits(statedTax) ?? 0n
  const total = parseMinorUnits(statedTotal) ?? 0n
  const netMatches = lineNet === net
  const taxMatches = lineTax === tax
  const totalMatches = net + tax === total
  const sumsOk = netMatches && taxMatches && totalMatches
  const formReady =
    hydrated &&
    !busy &&
    filled.length > 0 &&
    supplierInvoiceNumber !== '' &&
    contactNumber !== '' &&
    statedNet !== '' &&
    statedTax !== '' &&
    statedTotal !== '' &&
    filled.every((line) => line.accountNumber !== '' && line.taxCode !== '')
  /** Drafts may disagree with the document; booking needs the sums to add up. */
  const canSaveDraft = formReady
  const canBook = formReady && sumsOk

  function update(index: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)))
  }

  function suggestTax(index: number): void {
    const line = lines[index]
    if (line === undefined) return
    const code = inputCodes.find((entry) => entry.code === line.taxCode)
    const amount = parseMinorUnits(line.net)
    if (code === undefined || amount === null) return
    update(index, { tax: formatMinorUnits(percentOf(amount, code.ratePercent)) })
  }

  function addSplitLine(): void {
    setLines((current) => [...current, emptyLine(defaultAccount, defaultTax)])
  }

  async function captureAndMaybeBook(andBook: boolean): Promise<void> {
    if (andBook ? !canBook : !canSaveDraft) return
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

    if (!result.ok) {
      setBusy(false)
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item))
          : [result.problem.detail],
      )
      return
    }

    const invoiceId = result.data.id
    key.current = crypto.randomUUID()

    if (andBook) {
      const booked = await bookPurchaseInvoice({
        data: {
          invoiceId,
          idempotencyKey: crypto.randomUUID(),
          body: { bookingDate: null },
        },
      })
      if (!booked.ok) {
        setBusy(false)
        setProblems(
          booked.problem.violations.length > 0
            ? booked.problem.violations.map((item) => violationMessage(t, item))
            : [booked.problem.detail],
        )
        await navigate({ to: '/purchases/$invoiceId', params: { invoiceId } })
        return
      }
    }

    setBusy(false)
    await navigate({ to: '/purchases/$invoiceId', params: { invoiceId } })
  }

  // Always reads the latest form state — keyboard shortcuts must not save a
  // stale closure (QA: STALE-123 saved as STALE-1).
  const onCaptureShortcut = useEffectEvent((andBook: boolean) => {
    void captureAndMaybeBook(andBook)
  })

  function clearAttachedDocument(): void {
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setAttachedDocument(null)
    setDropNote(null)
  }

  async function onDropFiles(files: FileList): Promise<void> {
    const file = files.item(0)
    if (file === null) return
    // A second upload while a document is already on this bill could double-book.
    if (attachedDocument !== null) return
    setProblems([])
    setDropNote(null)

    if (previewUrl !== null) URL.revokeObjectURL(previewUrl)
    const localPreview =
      file.type.startsWith('image/') || file.type === 'application/pdf'
        ? URL.createObjectURL(file)
        : null
    setPreviewUrl(localPreview)

    setBusy(true)
    const base64 = btoa(
      Array.from(new Uint8Array(await file.arrayBuffer()), (byte) =>
        String.fromCharCode(byte),
      ).join(''),
    )
    const result = await receiveDocument({
      data: {
        idempotencyKey: dropKey.current,
        filename: file.name,
        contentType: file.type,
        base64,
      },
    })
    setBusy(false)
    dropKey.current = crypto.randomUUID()

    if (!result.ok) {
      clearAttachedDocument()
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item))
          : [result.problem.detail],
      )
      return
    }

    const documentId = result.data.documentId
    if (typeof documentId === 'string' && documentId !== '') {
      // Document belongs on this bill — never claim Postvak / offer a second drop.
      setAttachedDocument({ id: documentId, filename: file.name })
      setDropNote(null)
    } else {
      // No documentId: the only honest path left is Postvak.
      clearAttachedDocument()
      setDropNote(t('purchaseNew.dropUploaded'))
    }

    const parsed = result.data.parsed
    if (parsed !== null && parsed !== undefined) {
      const invoice = parsed.invoice
      setSupplierInvoiceNumber(invoice.supplierInvoiceNumber)
      setKind(invoice.kind === 'credit_note' ? 'credit_note' : 'invoice')
      setInvoiceDate(invoice.invoiceDate)
      setDueDate(invoice.dueDate)
      setStatedNet(formatMinorUnits(BigInt(invoice.net)))
      setStatedTax(formatMinorUnits(BigInt(invoice.tax)))
      setStatedTotal(formatMinorUnits(BigInt(invoice.total)))
      if (typeof parsed.paymentReference === 'string' && parsed.paymentReference !== '') {
        setPaymentReference(parsed.paymentReference)
      }
      if (result.data.matchedSupplier !== null) {
        setContactNumber(result.data.matchedSupplier.number)
      }
      if (invoice.lines.length > 0) {
        setLines(
          invoice.lines.map((line) => ({
            description: line.description,
            accountNumber:
              typeof line.accountNumber === 'string' && line.accountNumber !== ''
                ? line.accountNumber
                : defaultAccount,
            taxCode:
              typeof line.taxCode === 'string' && line.taxCode !== '' ? line.taxCode : defaultTax,
            net: formatMinorUnits(BigInt(line.net)),
            tax: formatMinorUnits(BigInt(line.tax)),
          })),
        )
      }
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    if (!hydrated) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      const mod = isApple() ? event.metaKey : event.ctrlKey
      if (event.key === 'Escape' && !isTypingInto(event.target)) {
        event.preventDefault()
        void navigate({ to: '/purchases' })
        return
      }
      if (!mod) return
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        onCaptureShortcut(false)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onCaptureShortcut(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [hydrated, navigate])

  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <header className="border-border flex flex-wrap items-center gap-3 border-b bg-surface px-0 py-4 md:px-0">
          <Link to="/purchases" className="text-ink-2 text-sm no-underline hover:text-ink">
            {t('purchaseNew.crumbCosts')}
          </Link>
          <span className="text-ink-muted" aria-hidden>
            /
          </span>
          <h1 className="text-base font-semibold">{t('purchaseNew.title')}</h1>
        </header>
        <p className="text-ink-2 border-border max-w-2xl rounded-[var(--radius-md)] border border-dashed p-4 text-sm">
          {t('purchaseNew.noSuppliers')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="border-border flex flex-wrap items-center gap-3 border-b bg-surface py-4">
        <Link to="/purchases" className="text-ink-2 text-sm no-underline hover:text-ink">
          {t('purchaseNew.crumbCosts')}
        </Link>
        <span className="text-ink-muted" aria-hidden>
          /
        </span>
        <h1 className="text-base font-semibold">{t('purchaseNew.title')}</h1>
        <Badge variant="secondary">{t('costs.pill.draft')}</Badge>
        <span className="flex-1" />
        <Button type="button" variant="outline" asChild>
          <Link to="/purchases">
            {t('purchaseNew.close')}
            {hydrated && <Keycap className="ml-1.5 hidden md:inline-flex">Esc</Keycap>}
          </Link>
        </Button>
        {/* Desktop: actions stay in the header. Phone uses sticky .form-actions (#38). */}
        <div className="hidden items-center gap-2 md:flex">
          {canSaveDraft && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void captureAndMaybeBook(false)
              }}
            >
              {busy ? t('common.busy') : t('purchaseNew.saveDraft')}
              {hydrated && !busy && (
                <span className="ml-1.5 hidden gap-0.5 normal-case md:inline-flex">
                  <Keycap>{modLabel}</Keycap>
                  <Keycap>S</Keycap>
                </span>
              )}
            </Button>
          )}
          {canBook && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                void captureAndMaybeBook(true)
              }}
            >
              {busy ? t('common.busy') : t('purchaseNew.book')}
              {hydrated && !busy && (
                <span className="ml-1.5 hidden gap-0.5 normal-case md:inline-flex">
                  <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                    {modLabel}
                  </Keycap>
                  <Keycap className="border-primary-foreground/40 bg-primary text-primary-foreground">
                    ↵
                  </Keycap>
                </span>
              )}
            </Button>
          )}
        </div>
      </header>

      <form
        className="py-6"
        onSubmit={(event) => {
          event.preventDefault()
          void captureAndMaybeBook(false)
        }}
      >
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
          <div className="flex min-w-0 flex-col gap-5">
            <p className="text-ink-2 m-0 text-sm">{t('purchaseNew.intro')}</p>

            <section className="border-border bg-surface grid grid-cols-1 gap-4 rounded-[var(--radius-xl)] border p-5 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <SelectField
                  label={t('contacts.supplierLabel')}
                  value={contactNumber}
                  onValueChange={setContactNumber}
                  disabled={!hydrated}
                >
                  {suppliers.map((supplier) => (
                    <SelectOption key={supplier.number} value={supplier.number}>
                      {supplier.name} · {supplier.number}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
              <SelectField
                label={t('purchaseNew.kind')}
                value={kind}
                disabled={!hydrated}
                onValueChange={(next) => {
                  setKind(next === 'credit_note' ? 'credit_note' : 'invoice')
                }}
              >
                <SelectOption value="invoice">{t('purchaseNew.kind.bill')}</SelectOption>
                <SelectOption value="credit_note">{t('purchaseNew.kind.credit')}</SelectOption>
              </SelectField>

              <label className="block">
                <span className="text-ink-muted mb-1 block text-xs font-medium">
                  {t('purchaseNew.supplierInvoiceNumber')}
                </span>
                <Input
                  aria-label={t('purchaseNew.supplierInvoiceNumber')}
                  value={supplierInvoiceNumber}
                  onChange={(event) => {
                    setSupplierInvoiceNumber(event.target.value)
                  }}
                  required
                  maxLength={64}
                  className="font-mono"
                />
              </label>
              <label className="block">
                <span className="text-ink-muted mb-1 block text-xs font-medium">
                  {t('purchaseNew.billDate')}
                </span>
                <Input
                  type="date"
                  aria-label={t('purchaseNew.billDate')}
                  value={invoiceDate}
                  onChange={(event) => {
                    changeInvoiceDate(event.target.value)
                    setDueDate(
                      addDays(event.target.value, selectedSupplier?.paymentTermsDays ?? 30),
                    )
                  }}
                  className="font-mono"
                />
              </label>
              <label className="block">
                <span className="text-ink-muted mb-1 block text-xs font-medium">
                  {t('purchaseNew.due')}
                </span>
                <Input
                  type="date"
                  aria-label={t('purchaseNew.due')}
                  value={dueDate}
                  onChange={(event) => {
                    setDueDate(event.target.value)
                  }}
                  className="font-mono"
                />
                <span className="text-ink-muted mt-1 block text-xs">
                  {t('purchaseNew.dueHelp')}
                </span>
              </label>
              <label className="block sm:col-span-3">
                <span className="text-ink-muted mb-1 block text-xs font-medium">
                  {t('purchaseNew.paymentReferenceOptional')}{' '}
                  <small className="font-normal">
                    {t('purchaseNew.paymentReferenceOptionalHint')}
                  </small>
                </span>
                <Input
                  aria-label={t('purchaseNew.paymentReferenceOptional')}
                  value={paymentReference}
                  onChange={(event) => {
                    setPaymentReference(event.target.value)
                  }}
                  placeholder={t('purchaseNew.paymentReferencePlaceholder')}
                  className="font-mono"
                />
              </label>
            </section>

            <section className="border-border bg-surface rounded-[var(--radius-xl)] border p-5">
              <h2 className="mb-3 text-[15px] font-semibold">{t('purchaseNew.asOnDocument')}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    [t('purchaseNew.excludingVatLabel'), statedNet, setStatedNet, netMatches],
                    [t('purchaseNew.vatLabel'), statedTax, setStatedTax, taxMatches],
                    [t('purchaseNew.totalLabel'), statedTotal, setStatedTotal, totalMatches],
                  ] as const
                ).map(([label, value, setValue, matches]) => (
                  <label key={label} className="block">
                    <span className="text-ink-muted mb-1 block text-xs font-medium">{label}</span>
                    <Input
                      aria-label={label}
                      value={value}
                      onChange={(event) => {
                        setValue(event.target.value)
                      }}
                      required
                      placeholder="0,00"
                      aria-invalid={!matches && value !== ''}
                      className={cn(
                        'font-mono text-right',
                        label === t('purchaseNew.totalLabel') && 'font-semibold',
                      )}
                    />
                  </label>
                ))}
              </div>
            </section>

            <p
              role="status"
              aria-live="polite"
              className={dateNotice === null ? 'sr-only' : 'text-ink-muted text-sm'}
            >
              {dateNotice ?? ''}
            </p>

            {(!netMatches || !taxMatches || !totalMatches) && filled.length > 0 && (
              <ul className="text-unreconciled space-y-1 text-sm">
                {!netMatches && <li>{t('purchaseNew.netDoesNotMatch')}</li>}
                {!taxMatches && <li>{t('purchaseNew.taxDoesNotMatch')}</li>}
                {!totalMatches && <li>{t('purchaseNew.totalDoesNotMatch')}</li>}
              </ul>
            )}

            {problems.length > 0 && (
              <ul role="alert" className="text-destructive space-y-1 text-sm">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}

            <p className="text-ink-muted m-0 text-[13px] leading-relaxed">
              {t('purchaseNew.saveNote')}
            </p>
          </div>

          <aside
            aria-label={t('purchaseNew.dropTitle')}
            className="flex min-w-0 flex-col gap-3"
            data-testid="billnew-document"
          >
            {attachedDocument === null ? (
              <DropZone
                title={t('purchaseNew.dropTitle')}
                description={t('purchaseNew.dropBody')}
                chooseLabel={t('purchaseNew.dropChoose')}
                accept=".pdf,.xml,image/*,application/pdf,application/xml,text/xml"
                disabled={busy || !hydrated}
                onFiles={(files) => {
                  void onDropFiles(files)
                }}
                className="gap-3 py-10"
              />
            ) : (
              <div className="border-border bg-surface flex flex-col gap-2 rounded-[var(--radius-xl)] border p-4">
                <p className="m-0 text-sm font-medium" data-testid="billnew-document-attached">
                  {t('purchaseNew.dropAttached', { filename: attachedDocument.filename })}
                </p>
                <p className="text-ink-muted m-0 text-[13px]">
                  {t('purchaseNew.dropAttachedHint')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    clearAttachedDocument()
                  }}
                >
                  {t('purchaseNew.dropRemove')}
                </Button>
              </div>
            )}
            {/* Postvak note only when nothing is attached to this bill (Legal). */}
            {attachedDocument === null && dropNote !== null && (
              <p className="text-ink-2 text-sm">
                {dropNote}{' '}
                <Link to="/inbox" className="font-semibold underline-offset-2 hover:underline">
                  {t('purchaseNew.dropOpenInbox')}
                </Link>
              </p>
            )}
            {previewUrl !== null && (
              <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border">
                <iframe
                  title={
                    attachedDocument !== null
                      ? attachedDocument.filename
                      : t('purchaseNew.dropTitle')
                  }
                  src={previewUrl}
                  className="h-72 w-full"
                />
              </div>
            )}
            {selectedSupplier !== null && (
              <section className="border-border bg-surface flex flex-col gap-2 rounded-[var(--radius-xl)] border p-4 text-[13px]">
                <strong className="text-sm">
                  {t('purchaseNew.supplierEarlier', { name: selectedSupplier.name })}
                </strong>
                <div className="flex justify-between gap-2">
                  <span className="text-ink-muted">{t('purchaseNew.supplierPaysIn')}</span>
                  <span>
                    {plural('purchaseNew.supplierPaysDays', selectedSupplier.paymentTermsDays, {
                      days: String(selectedSupplier.paymentTermsDays),
                    })}
                  </span>
                </div>
              </section>
            )}
          </aside>

          <section
            data-testid="billnew-lines"
            className="border-border bg-surface min-w-0 overflow-x-auto rounded-[var(--radius-xl)] border lg:col-span-2"
            aria-labelledby="billnew-lines"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
              <h2 id="billnew-lines" className="text-[15px] font-semibold">
                {t('purchaseNew.whatFor')}
              </h2>
              <span className="text-ink-muted text-[13px]">{t('purchaseNew.whatForHint')}</span>
            </div>
            {/* One DOM: stacked cards below md so amounts never clip; table from md (#175 QA). */}
            <div className="w-full min-w-0" data-testid="billnew-lines-grid">
              <div className="bg-surface-hover text-ink-muted hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(4.5rem,0.7fr)_minmax(4.5rem,0.65fr)_minmax(4.5rem,0.65fr)_minmax(2.75rem,2.75rem)] items-center text-xs font-semibold tracking-wide uppercase md:grid">
                <span className="px-2.5 py-2 pl-5">{t('purchaseNew.col.description')}</span>
                <span className="px-2.5 py-2">{t('purchaseNew.col.category')}</span>
                <span className="px-2.5 py-2">{t('purchaseNew.col.vatCode')}</span>
                <span className="px-2.5 py-2 text-right">{t('purchaseNew.col.excl')}</span>
                <span className="px-2.5 py-2 text-right">{t('purchaseNew.col.vatAmount')}</span>
                <span />
              </div>
              {lines.map((line, index) => (
                <div
                  key={index}
                  data-testid={`billnew-line-${String(index + 1)}`}
                  className={cn(
                    'border-line-soft border-t',
                    'mx-4 my-3 flex flex-col gap-3 rounded-[var(--radius-md)] border border-border p-3',
                    'md:mx-0 md:my-0 md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(4.5rem,0.7fr)_minmax(4.5rem,0.65fr)_minmax(4.5rem,0.65fr)_minmax(2.75rem,2.75rem)] md:items-center md:rounded-none md:border-0 md:border-t md:border-line-soft md:p-0',
                  )}
                >
                  <Input
                    aria-label={t('entryNew.descriptionLine', { line: String(index + 1) })}
                    value={line.description}
                    onChange={(event) => {
                      update(index, { description: event.target.value })
                      if (index === lines.length - 1 && event.target.value !== '') {
                        setLines((current) => [...current, emptyLine(defaultAccount, defaultTax)])
                      }
                    }}
                    className="h-11 rounded-[var(--radius-md)] border border-input bg-transparent shadow-none md:h-10 md:rounded-none md:border-0 md:border-r md:border-line-soft md:pl-5"
                  />
                  <div className="min-w-0 md:border-r md:border-line-soft">
                    <AccountPicker
                      label={t('invoiceNew.accountLine', { line: String(index + 1) })}
                      labelHidden
                      accounts={costAccounts}
                      value={line.accountNumber}
                      disabled={!hydrated}
                      onValueChange={(next) => {
                        update(index, { accountNumber: next })
                      }}
                    />
                  </div>
                  <div className="min-w-0 md:border-r md:border-line-soft">
                    <SelectField
                      label={t('purchaseNew.taxCodeLine', { line: String(index + 1) })}
                      labelHidden
                      value={line.taxCode}
                      disabled={!hydrated}
                      onValueChange={(next) => {
                        update(index, { taxCode: next })
                      }}
                      triggerClassName="h-11 rounded-[var(--radius-md)] border border-input bg-transparent shadow-none md:h-10 md:rounded-none md:border-0"
                    >
                      {line.taxCode === '' || inputCodes.length === 0 ? (
                        <SelectOption value="">{t('purchaseNew.chooseVat')}</SelectOption>
                      ) : null}
                      {inputCodes.map((code) => (
                        <SelectOption key={code.code} value={code.code}>
                          {code.code} · {code.ratePercent}%
                        </SelectOption>
                      ))}
                    </SelectField>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:contents">
                    <Input
                      aria-label={t('purchaseNew.netLine', { line: String(index + 1) })}
                      value={line.net}
                      onChange={(event) => {
                        update(index, { net: event.target.value })
                      }}
                      className="h-11 rounded-[var(--radius-md)] border border-input bg-transparent font-mono shadow-none md:h-10 md:rounded-none md:border-0 md:border-r md:border-line-soft md:text-right"
                    />
                    <Input
                      aria-label={t('invoiceNew.vatLine', { line: String(index + 1) })}
                      value={line.tax}
                      onChange={(event) => {
                        update(index, { tax: event.target.value })
                      }}
                      className="h-11 rounded-[var(--radius-md)] border border-input bg-transparent font-mono shadow-none md:h-10 md:rounded-none md:border-0 md:border-r md:border-line-soft md:text-right"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={t('purchaseNew.computeTaxLine', { line: String(index + 1) })}
                    title={t('purchaseNew.computeTaxTitle')}
                    disabled={!hydrated}
                    onClick={() => {
                      suggestTax(index)
                    }}
                    className="text-ink-muted inline-flex min-h-11 min-w-11 items-center justify-center self-start px-1 text-xs underline disabled:opacity-50 md:min-h-0 md:min-w-0 md:self-auto"
                  >
                    ƒ
                  </button>
                </div>
              ))}
            </div>
            <div className="border-line-soft flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5">
              <Button type="button" variant="outline" size="sm" onClick={addSplitLine}>
                + {t('purchaseNew.splitCategory')}
              </Button>
              {sumsOk && filled.length > 0 ? (
                <span className="text-success inline-flex items-center gap-1.5 text-sm font-medium">
                  <Check className="size-4" aria-hidden />
                  {t('purchaseNew.linesMatch', {
                    amount: `€\u00a0${formatMinorUnits(total)}`,
                  })}
                </span>
              ) : filled.length > 0 ? (
                <span className="text-destructive text-sm">{t('purchaseNew.linesMismatch')}</span>
              ) : null}
            </div>
          </section>
        </div>

        {/* Sticky on phone so save/book stay above the OSK + tab bar (#38 / #175).
            No keyboard chips here — .form-actions is md:hidden. */}
        <div
          data-testid="billnew-form-actions"
          className={cn('form-actions md:hidden', !canSaveDraft && !canBook && 'hidden')}
        >
          {canSaveDraft && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void captureAndMaybeBook(false)
              }}
            >
              {busy ? t('common.busy') : t('purchaseNew.saveDraft')}
            </Button>
          )}
          {canBook && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                void captureAndMaybeBook(true)
              }}
            >
              {busy ? t('common.busy') : t('purchaseNew.book')}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
