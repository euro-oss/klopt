import { Link } from '@tanstack/react-router'
import { Shield } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Money } from '~/components/finance/money'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import {
  contactInitials,
  contactRoleLabel,
  missingEInvoicingDetails,
  salesDocStatus,
  supplierOpenSummary,
  type ContactListRow,
  type ContactPurchaseDoc,
  type ContactSalesDoc,
} from '~/lib/contacts-list'
import { formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { getContact, pseudonymiseContact } from '~/server/sales'

export type ContactCardPurchaseDoc = {
  readonly id: string
  readonly total: string
  readonly outstanding: string
  readonly dueDate: string
  readonly status: string
  readonly supplierInvoiceNumber: string
  readonly contactNumber: string
}

type ContactAggregateSlice = {
  readonly volumeMinor: bigint
  readonly documentCount: number
  readonly openMinor: bigint
  readonly lateDays: number | null
}

type DetailOk = {
  readonly ok: true
  readonly contact: {
    readonly email: string | null
    readonly iban: string | null
    readonly vatNumber: string | null
    readonly isSupplier: boolean
    readonly address: {
      readonly street: string | null
      readonly postalCode: string | null
      readonly city: string | null
    } | null
  }
  readonly openDocuments: { readonly sales: number; readonly purchase: number }
  readonly canErase: boolean
}

type DetailState = DetailOk | { readonly ok: false; readonly detail: string } | null

function useContactCardDetail(contactId: string): DetailState {
  const [detail, setDetail] = useState<DetailState>(null)

  useEffect(() => {
    let cancelled = false
    void getContact({ data: { contactId } }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setDetail({ ok: false, detail: result.problem.detail })
        return
      }
      setDetail({
        ok: true,
        contact: result.data.contact,
        openDocuments: result.data.openDocuments,
        canErase: result.data.canErase,
      })
    })
    return () => {
      cancelled = true
    }
  }, [contactId])

  return detail
}

function useContactCardCopy({
  contact,
  aggregate,
  purchaseDocs,
  asOf,
  detail,
}: {
  contact: ContactListRow
  aggregate: ContactAggregateSlice | undefined
  purchaseDocs: readonly ContactCardPurchaseDoc[]
  asOf: string
  detail: DetailState
}) {
  const { t, plural } = useT()
  const year = asOf.slice(0, 4)

  const volume = aggregate?.volumeMinor ?? 0n
  const docs = aggregate?.documentCount ?? 0
  const openMinor = aggregate?.openMinor ?? 0n
  const openCount =
    detail !== null && detail.ok ? detail.openDocuments.sales + detail.openDocuments.purchase : 0

  const roleLabels = {
    customer: t('contacts.customerLabel'),
    supplier: t('contacts.supplierLabel'),
    both: t('contacts.roleBoth'),
  }
  const role = contactRoleLabel(contact, roleLabels)
  const sub =
    detail !== null && detail.ok && detail.contact.address?.city
      ? detail.contact.address.city
      : contact.number

  const needsDetails =
    detail !== null &&
    detail.ok &&
    missingEInvoicingDetails({
      email: detail.contact.email,
      iban: detail.contact.iban,
      isSupplier: detail.contact.isSupplier,
      address: detail.contact.address,
    })

  const volLabel = contact.isCustomer
    ? t('contacts.card.volCustomer', { year })
    : t('contacts.card.volSupplier', { year })

  const docLabel = contact.isCustomer
    ? plural('contacts.card.invoices', docs, { count: String(docs) })
    : plural('contacts.card.bills', docs, { count: String(docs) })

  const purchaseSide: readonly ContactPurchaseDoc[] = purchaseDocs.map((bill) => ({
    id: bill.id,
    contactNumber: bill.contactNumber,
    total: bill.total,
    outstanding: bill.outstanding,
    dueDate: bill.dueDate,
    status: bill.status,
  }))
  const supplierSummary = supplierOpenSummary(purchaseSide, asOf)
  const supplierOpenLine =
    supplierSummary.openCount === 0
      ? t('contacts.card.supplierOpenNone')
      : t('contacts.card.supplierOpenSummary', {
          count: String(supplierSummary.openCount),
          amount: formatMinorUnits(supplierSummary.openMinor),
        }) +
        (supplierSummary.overdueCount > 0
          ? plural('contacts.card.supplierOverdueSuffix', supplierSummary.overdueCount, {
              count: String(supplierSummary.overdueCount),
            })
          : '')

  return {
    volume,
    docs,
    openMinor,
    openCount,
    role,
    sub,
    needsDetails,
    volLabel,
    docLabel,
    supplierOpenLine,
    supplierSummary,
  }
}

function FiguresRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-t border-[var(--line-soft)] px-4 py-3 text-sm first:border-t-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}

export function ContactCard({
  contact,
  aggregate,
  salesDocs,
  purchaseDocs,
  openByInvoiceId,
  asOf,
  onErased,
}: {
  contact: ContactListRow
  aggregate: ContactAggregateSlice | undefined
  salesDocs: readonly ContactSalesDoc[]
  purchaseDocs: readonly ContactCardPurchaseDoc[]
  openByInvoiceId: ReadonlyMap<string, bigint>
  asOf: string
  onErased: () => void
}) {
  const { t } = useT()
  const hydrated = useHydrated()
  const detail = useContactCardDetail(contact.id)
  const copy = useContactCardCopy({
    contact,
    aggregate,
    purchaseDocs,
    asOf,
    detail,
  })

  return (
    <aside
      aria-label={t('contacts.card')}
      className="border-border bg-surface hidden min-w-0 flex-[999_1_420px] flex-col overflow-hidden rounded-[var(--radius-xl)] border md:flex"
    >
      <div className="flex flex-col gap-4 border-b border-[var(--line-soft)] px-6 py-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
            aria-hidden="true"
          >
            {contactInitials(contact.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              data-contact-name=""
              title={contact.name}
              className="break-words text-xl leading-[26px] font-semibold"
            >
              {contact.name}
            </span>
            <span className="text-ink-muted">
              {copy.role} · {copy.sub}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {contact.isCustomer && (
            <Button asChild size="sm">
              <Link to="/invoices/new">
                {t('contacts.card.newInvoice')}
                {hydrated && (
                  <span className="ml-1 inline-flex gap-0.5 normal-case">
                    <Keycap className="bg-primary-foreground/15 text-primary-foreground">n</Keycap>
                    <Keycap className="bg-primary-foreground/15 text-primary-foreground">f</Keycap>
                  </span>
                )}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/contacts/$contactId" params={{ contactId: contact.id }}>
              {t('contacts.card.edit')}
              {hydrated && (
                <span className="ml-1">
                  <Keycap>e</Keycap>
                </span>
              )}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-[var(--line-soft)]">
        <div className="flex flex-col gap-1 border-r border-[var(--line-soft)] px-6 py-4">
          <span className="text-ink-muted text-[13px]">{copy.volLabel}</span>
          <span className="text-xl font-semibold tabular-nums">
            €&nbsp;
            <Money amount={copy.volume} />
          </span>
        </div>
        <div className="flex flex-col gap-1 border-r border-[var(--line-soft)] px-6 py-4">
          <span className="text-ink-muted text-[13px]">{t('contacts.card.documents')}</span>
          <span className="text-xl font-semibold tabular-nums">{copy.docLabel}</span>
        </div>
        <div className="flex flex-col gap-1 px-6 py-4">
          <span className="text-ink-muted text-[13px]">{t('contacts.card.stillOpen')}</span>
          <span
            className={cn(
              'text-xl font-semibold tabular-nums',
              copy.openMinor > 0n && 'text-destructive',
            )}
          >
            €&nbsp;
            <Money amount={copy.openMinor} />
          </span>
        </div>
      </div>

      <ContactCardInvoices
        contact={contact}
        salesDocs={salesDocs}
        openByInvoiceId={openByInvoiceId}
        layout="desktop"
      />

      <ContactCardSupplierBlock
        contact={contact}
        purchaseDocs={purchaseDocs}
        supplierOpenLine={copy.supplierOpenLine}
        layout="desktop"
      />

      <ContactCardDetails
        contact={contact}
        detail={detail}
        needsDetails={copy.needsDetails}
        layout="desktop"
      />

      {detail !== null && detail.ok && detail.canErase && (
        <PrivacyErase
          contactId={contact.id}
          openCount={copy.openCount}
          onErased={onErased}
          layout="desktop"
        />
      )}

      {detail !== null && !detail.ok && (
        <p role="alert" className="text-destructive px-6 pb-4 text-sm">
          {detail.detail}
        </p>
      )}
    </aside>
  )
}

/** PhoneContactCard — `PhoneContactCard.dc.html` / dark derived board (#130). */
export function PhoneContactCard({
  contact,
  aggregate,
  salesDocs,
  purchaseDocs,
  openByInvoiceId,
  asOf,
  onErased,
}: {
  contact: ContactListRow
  aggregate: ContactAggregateSlice | undefined
  salesDocs: readonly ContactSalesDoc[]
  purchaseDocs: readonly ContactCardPurchaseDoc[]
  openByInvoiceId: ReadonlyMap<string, bigint>
  asOf: string
  onErased: () => void
}) {
  const { t } = useT()
  const hydrated = useHydrated()
  const detail = useContactCardDetail(contact.id)
  const copy = useContactCardCopy({
    contact,
    aggregate,
    purchaseDocs,
    asOf,
    detail,
  })

  return (
    <div
      role="complementary"
      aria-label={t('contacts.card')}
      className="flex flex-col gap-4 md:hidden"
    >
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" className="min-h-11 shrink-0 px-2">
          <Link to="/contacts">{t('contacts.phoneBack')}</Link>
        </Button>
        <span className="flex-1" aria-hidden="true" />
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/contacts/$contactId" params={{ contactId: contact.id }} search={{ edit: true }}>
            {t('contacts.card.edit')}
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3.5">
        <span
          className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
          aria-hidden="true"
        >
          {contactInitials(contact.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            data-contact-name=""
            title={contact.name}
            className="break-words text-xl leading-[26px] font-semibold"
          >
            {contact.name}
          </span>
          <span className="text-ink-muted text-sm">
            {copy.role} · {copy.sub}
          </span>
        </div>
      </div>

      {contact.isCustomer && (
        <Button asChild className="min-h-12 w-full justify-center text-[15px]">
          <Link to="/invoices/new">{t('contacts.card.newInvoice')}</Link>
        </Button>
      )}

      <section
        aria-label={t('contacts.card.figures')}
        className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border"
      >
        <FiguresRow label={copy.volLabel}>
          <span className="text-[17px] font-semibold">
            €&nbsp;
            <Money amount={copy.volume} />
          </span>
        </FiguresRow>
        <FiguresRow label={t('contacts.card.documents')}>
          <span className="text-[17px] font-semibold">{copy.docLabel}</span>
        </FiguresRow>
        <FiguresRow label={t('contacts.card.stillOpen')}>
          <span
            className={cn(
              'text-[17px] font-semibold',
              copy.openMinor > 0n && 'text-destructive',
            )}
          >
            €&nbsp;
            <Money amount={copy.openMinor} />
          </span>
        </FiguresRow>
      </section>

      <ContactCardInvoices
        contact={contact}
        salesDocs={salesDocs}
        openByInvoiceId={openByInvoiceId}
        layout="phone"
      />

      <ContactCardSupplierBlock
        contact={contact}
        purchaseDocs={purchaseDocs}
        supplierOpenLine={copy.supplierOpenLine}
        layout="phone"
      />

      <ContactCardDetails
        contact={contact}
        detail={detail}
        needsDetails={copy.needsDetails}
        layout="phone"
      />

      {detail !== null && detail.ok && detail.canErase && (
        <PrivacyErase
          contactId={contact.id}
          openCount={copy.openCount}
          onErased={onErased}
          layout="phone"
        />
      )}

      {detail !== null && !detail.ok && (
        <p role="alert" className="text-destructive text-sm">
          {detail.detail}
        </p>
      )}

      {!hydrated && <span className="sr-only">{t('common.busy')}</span>}
    </div>
  )
}

function ContactCardInvoices({
  contact,
  salesDocs,
  openByInvoiceId,
  layout,
}: {
  contact: ContactListRow
  salesDocs: readonly ContactSalesDoc[]
  openByInvoiceId: ReadonlyMap<string, bigint>
  layout: 'desktop' | 'phone'
}) {
  const { t } = useT()
  if (!contact.isCustomer || salesDocs.length === 0) return null

  if (layout === 'desktop') {
    return (
      <>
        <h2 className="text-ink-muted px-6 pt-4 pb-2 text-xs font-semibold tracking-[0.04em] uppercase">
          {t('contacts.card.invoicesHeading')}
        </h2>
        {salesDocs.slice(0, 8).map((doc) => (
          <InvoiceRow key={doc.id} doc={doc} openByInvoiceId={openByInvoiceId} layout="desktop" />
        ))}
      </>
    )
  }

  return (
    <section
      aria-labelledby="contact-invoices-h"
      className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border"
    >
      <h2
        id="contact-invoices-h"
        className="text-ink-muted px-4 pt-3.5 pb-2 text-xs font-semibold tracking-[0.04em] uppercase"
      >
        {t('contacts.card.invoicesHeading')}
      </h2>
      {salesDocs.slice(0, 8).map((doc) => (
        <InvoiceRow key={doc.id} doc={doc} openByInvoiceId={openByInvoiceId} layout="phone" />
      ))}
    </section>
  )
}

function InvoiceRow({
  doc,
  openByInvoiceId,
  layout,
}: {
  doc: ContactSalesDoc
  openByInvoiceId: ReadonlyMap<string, bigint>
  layout: 'desktop' | 'phone'
}) {
  const { t } = useT()
  const status = salesDocStatus(doc, openByInvoiceId)

  if (layout === 'phone') {
    return (
      <Link
        to="/invoices/$invoiceId"
        params={{ invoiceId: doc.id }}
        className="hover:bg-[var(--surface-hover)] flex min-h-16 flex-col justify-center gap-1.5 border-t border-[var(--line-soft)] px-4 py-3 text-[var(--ink)] no-underline"
      >
        <span className="flex justify-between gap-3 text-[15px] font-semibold tabular-nums">
          <span>{doc.number ?? t('contacts.card.draft')}</span>
          <span>
            €&nbsp;
            <Money amount={doc.total} />
          </span>
        </span>
        <span>
          {status.pill !== null ? (
            <Badge variant={status.pill === 'draft' ? 'secondary' : 'default'}>
              {t(`contacts.pill.${status.pill}` as MessageKey)}
            </Badge>
          ) : status.openMinor !== null ? (
            <span className="text-ink-2 text-sm tabular-nums">
              {t('contacts.card.docOpen', {
                amount: formatMinorUnits(status.openMinor),
              })}
            </span>
          ) : null}
        </span>
      </Link>
    )
  }

  return (
    <Link
      to="/invoices/$invoiceId"
      params={{ invoiceId: doc.id }}
      className="hover:bg-[var(--surface-hover)] flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-6 py-2.5 text-sm no-underline"
    >
      <span className="flex-1 tabular-nums">{doc.number ?? t('contacts.card.draft')}</span>
      {status.pill !== null ? (
        <Badge variant={status.pill === 'draft' ? 'secondary' : 'default'}>
          {t(`contacts.pill.${status.pill}` as MessageKey)}
        </Badge>
      ) : status.openMinor !== null ? (
        <span className="text-ink-2 tabular-nums">
          {t('contacts.card.docOpen', {
            amount: formatMinorUnits(status.openMinor),
          })}
        </span>
      ) : null}
      <span className="w-[100px] text-right tabular-nums">
        €&nbsp;
        <Money amount={doc.total} />
      </span>
    </Link>
  )
}

function ContactCardSupplierBlock({
  contact,
  purchaseDocs,
  supplierOpenLine,
  layout,
}: {
  contact: ContactListRow
  purchaseDocs: readonly ContactCardPurchaseDoc[]
  supplierOpenLine: string
  layout: 'desktop' | 'phone'
}) {
  const { t } = useT()
  if (!contact.isSupplier) return null
  if (contact.isCustomer && purchaseDocs.length === 0) return null
  if (!contact.isCustomer && layout === 'phone') {
    return (
      <section className="border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-xl)] border p-4">
        <span className="text-ink-2 text-sm">{supplierOpenLine}</span>
        <Button asChild variant="outline" className="min-h-11 w-full">
          <Link to="/purchases" search={{ open: true }}>
            {t('contacts.card.openCosts')}
          </Link>
        </Button>
      </section>
    )
  }
  if (!contact.isCustomer) {
    return (
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <span className="text-ink-2 text-sm">{supplierOpenLine}</span>
        <Button asChild variant="outline" size="sm">
          <Link to="/purchases" search={{ open: true }}>
            {t('contacts.card.openCosts')}
          </Link>
        </Button>
      </div>
    )
  }

  const className =
    layout === 'phone'
      ? 'border-border bg-surface flex flex-col gap-3 rounded-[var(--radius-xl)] border p-4'
      : 'flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-6 py-4'

  return (
    <div className={className}>
      <span className="text-ink-2 text-sm">{supplierOpenLine}</span>
      <Button
        asChild
        variant="outline"
        size={layout === 'phone' ? 'default' : 'sm'}
        className={layout === 'phone' ? 'min-h-11 w-full' : undefined}
      >
        <Link to="/purchases" search={{ open: true }}>
          {t('contacts.card.openCosts')}
        </Link>
      </Button>
    </div>
  )
}

function ContactCardDetails({
  contact,
  detail,
  needsDetails,
  layout,
}: {
  contact: ContactListRow
  detail: DetailState
  needsDetails: boolean
  layout: 'desktop' | 'phone'
}) {
  const { t, plural } = useT()

  if (layout === 'phone') {
    return (
      <section
        aria-label={t('contacts.card.details')}
        className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border"
      >
        <FiguresRow label={t('contacts.card.number')}>
          <span className="font-mono text-sm">{contact.number}</span>
        </FiguresRow>
        <FiguresRow label={t('contacts.vatNumber')}>
          <span className="font-mono text-sm">
            {detail !== null && detail.ok
              ? (detail.contact.vatNumber ?? '–')
              : (contact.vatNumber ?? '–')}
          </span>
        </FiguresRow>
        <FiguresRow label={t('contacts.paymentTerms')}>
          {plural('contacts.termsDays', contact.paymentTermsDays, {
            days: String(contact.paymentTermsDays),
          })}
        </FiguresRow>
        <div className="flex flex-col gap-0.5 border-t border-[var(--line-soft)] px-4 py-3">
          <span className="text-ink-muted text-sm">{t('contacts.card.details')}</span>
          {needsDetails ? (
            <>
              <Link
                to="/contacts/$contactId"
                params={{ contactId: contact.id }}
                search={{ edit: true }}
                className="text-ink inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
              >
                {t('contacts.card.addDetails')}
              </Link>
              <span className="text-ink-muted text-[13px]">{t('contacts.card.einvoiceHint')}</span>
            </>
          ) : (
            <span className="text-ink-muted text-sm">{t('contacts.card.detailsOk')}</span>
          )}
        </div>
      </section>
    )
  }

  return (
    <dl className="grid grid-cols-[150px_1fr] gap-y-2.5 border-t border-[var(--line-soft)] px-6 py-4 text-sm">
      <dt className="text-ink-muted">{t('contacts.card.number')}</dt>
      <dd className="m-0 font-mono tabular-nums">{contact.number}</dd>
      <dt className="text-ink-muted">{t('contacts.vatNumber')}</dt>
      <dd className="m-0 font-mono tabular-nums">
        {detail !== null && detail.ok
          ? (detail.contact.vatNumber ?? '–')
          : (contact.vatNumber ?? '–')}
      </dd>
      <dt className="text-ink-muted">{t('contacts.paymentTerms')}</dt>
      <dd className="m-0">
        {plural('contacts.termsDays', contact.paymentTermsDays, {
          days: String(contact.paymentTermsDays),
        })}
      </dd>
      <dt className="text-ink-muted">{t('contacts.card.details')}</dt>
      <dd className="m-0">
        {needsDetails ? (
          <>
            <Link
              to="/contacts/$contactId"
              params={{ contactId: contact.id }}
              className="text-link underline underline-offset-2"
            >
              {t('contacts.card.addDetails')}
            </Link>{' '}
            <span className="text-ink-muted">· {t('contacts.card.einvoiceNeed')}</span>
          </>
        ) : (
          <span className="text-ink-muted">{t('contacts.card.detailsOk')}</span>
        )}
      </dd>
    </dl>
  )
}

function PrivacyErase({
  contactId,
  openCount,
  onErased,
  layout,
}: {
  contactId: string
  openCount: number
  onErased: () => void
  layout: 'desktop' | 'phone'
}) {
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [askReason, setAskReason] = useState(false)
  const key = useRef(crypto.randomUUID())

  async function erase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const field = new FormData(event.currentTarget).get('reason')
    const reason = typeof field === 'string' ? field.trim() : ''
    if (reason === '') return

    setBusy(true)
    setError(null)
    const result = await pseudonymiseContact({
      data: { contactId, idempotencyKey: key.current, reason },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    key.current = crypto.randomUUID()
    setDone(true)
    onErased()
  }

  if (layout === 'phone') {
    return (
      <section
        aria-labelledby="contact-privacy-h"
        className="border-border bg-surface flex flex-col gap-2.5 rounded-[var(--radius-xl)] border p-4"
      >
        <span className="flex items-center gap-2.5">
          <Shield className="text-ink-muted size-[18px] shrink-0" aria-hidden="true" />
          <strong id="contact-privacy-h" className="text-[15px] font-semibold">
            {t('contacts.privacy.title')}
          </strong>
        </span>
        <span className="text-ink-2 text-sm leading-normal">
          {openCount > 0
            ? plural('contacts.privacy.blocked', openCount, { count: String(openCount) })
            : t('contacts.privacy.ok')}
        </span>
        {askReason && openCount === 0 && (
          <form onSubmit={(event) => void erase(event)} className="space-y-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('erase.reason')}
              </span>
              <Input name="reason" required placeholder={t('erase.reasonPlaceholder')} />
            </label>
            <p className="text-destructive text-xs">{t('erase.irreversible')}</p>
            {error !== null && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            {done && <p className="text-sm">{t('erase.done')}</p>}
            <Button type="submit" className="min-h-11 w-full" disabled={busy || !hydrated}>
              {busy ? t('common.busy') : t('contacts.privacy.erase')}
            </Button>
          </form>
        )}
        {!askReason && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-center"
            disabled={openCount > 0 || !hydrated || done}
            onClick={() => {
              if (openCount === 0) setAskReason(true)
            }}
          >
            {t('contacts.privacy.erase')}
          </Button>
        )}
      </section>
    )
  }

  return (
    <div className="bg-surface-sunken mx-6 mb-6 flex items-start gap-3 rounded-[var(--radius-md)] p-3.5 text-[13px]">
      <Shield className="text-ink-muted mt-0.5 size-[18px] shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="text-sm font-semibold">{t('contacts.privacy.title')}</strong>
        <span className="text-ink-muted">
          {openCount > 0
            ? plural('contacts.privacy.blocked', openCount, { count: String(openCount) })
            : t('contacts.privacy.ok')}
        </span>
        {askReason && openCount === 0 && (
          <form onSubmit={(event) => void erase(event)} className="mt-2 space-y-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('erase.reason')}
              </span>
              <Input name="reason" required placeholder={t('erase.reasonPlaceholder')} />
            </label>
            <p className="text-destructive text-xs">{t('erase.irreversible')}</p>
            {error !== null && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            {done && <p className="text-sm">{t('erase.done')}</p>}
            <Button type="submit" size="sm" disabled={busy || !hydrated}>
              {busy ? t('common.busy') : t('contacts.privacy.erase')}
            </Button>
          </form>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={openCount > 0 || !hydrated || done}
        onClick={() => {
          setAskReason(true)
        }}
      >
        {t('contacts.privacy.erase')}
      </Button>
    </div>
  )
}
