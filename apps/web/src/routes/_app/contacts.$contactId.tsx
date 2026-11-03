import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PhoneContactCard } from '~/components/contacts/contact-card'
import { PageHeader } from '~/components/app-shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useT } from '~/i18n/provider'
import {
  aggregateContacts,
  CONTACTS_DOCS_FETCH_LIMIT,
  type ContactListRow,
  type ContactSalesDoc,
} from '~/lib/contacts-list'
import { useHydrated } from '~/lib/hydration'
import { localTodayIso } from '~/lib/local-clock'
import { listPurchaseInvoices } from '~/server/purchase'
import {
  getContact,
  listInvoices,
  listOverdueInvoices,
  pseudonymiseContact,
  updateContact,
} from '~/server/sales'

/**
 * Contact detail (#130): phone card at 390 (`PhoneContactCard` boards) and
 * desktop edit form. Phone edit opens with `?edit=1` from the card.
 */
export const Route = createFileRoute('/_app/contacts/$contactId')({
  validateSearch: (search: Record<string, unknown>): { edit?: boolean } => {
    const edit = search['edit'] === true || search['edit'] === '1' || search['edit'] === 'true'
    return edit ? { edit: true } : {}
  },
  loader: async ({ params }) => {
    const asOf = localTodayIso()
    const [contact, invoices, purchases, overdue] = await Promise.all([
      getContact({ data: { contactId: params.contactId } }),
      listInvoices({ data: { status: null, limit: CONTACTS_DOCS_FETCH_LIMIT } }),
      listPurchaseInvoices({ data: {} }),
      listOverdueInvoices({ data: { asOf } }),
    ])
    return { contact, invoices, purchases, overdue, asOf }
  },
  component: ContactDetail,
})

/** Matches Tailwind `md` — phone card vs desktop edit are mutually exclusive in the tree. */
function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia('(max-width: 767px)')
      media.addEventListener('change', onChange)
      return () => {
        media.removeEventListener('change', onChange)
      }
    },
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false,
  )
}

function contactToListRow(row: {
  readonly id: string
  readonly number: string
  readonly name: string
  readonly isCustomer: boolean
  readonly isSupplier: boolean
  readonly email: string | null
  readonly vatNumber: string | null
  readonly countryCode: string
  readonly paymentTermsDays: number
  readonly isBlocked: boolean
}): ContactListRow {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    isCustomer: row.isCustomer,
    isSupplier: row.isSupplier,
    email: row.email,
    vatNumber: row.vatNumber,
    countryCode: row.countryCode,
    paymentTermsDays: row.paymentTermsDays,
    isBlocked: row.isBlocked,
  }
}

function ContactDetail() {
  const { contact, invoices, purchases, overdue, asOf } = Route.useLoaderData()
  const { contactId } = Route.useParams()
  const { edit } = Route.useSearch()
  const router = useRouter()
  const phoneLayout = usePhoneLayout()

  const cardData = useMemo(() => {
    if (!contact.ok) return null
    const listRow = contactToListRow(contact.data.contact)
    const salesDocs: readonly ContactSalesDoc[] = invoices.ok
      ? invoices.data.invoices
          .filter((inv) => inv.contactNumber === listRow.number)
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            total: invoice.total,
            contactNumber: invoice.contactNumber,
            status: invoice.status,
            kind: invoice.kind,
            dueDate: invoice.dueDate,
          }))
      : []
    const purchaseDocs = purchases.ok
      ? purchases.data.invoices.filter((inv) => inv.contactNumber === listRow.number)
      : []
    const overdueRows = overdue.ok ? overdue.data.invoices : []
    const aggregates = aggregateContacts(
      [listRow],
      salesDocs,
      purchaseDocs.map((row) => ({
        id: row.id,
        contactNumber: row.contactNumber,
        total: row.total,
        outstanding: row.outstanding,
        dueDate: row.dueDate,
        status: row.status,
      })),
      overdueRows.map((row) => ({
        id: row.id,
        contactName: row.contactName,
        total: row.total,
        daysOverdue: row.daysOverdue,
      })),
    )
    const openByInvoiceId = new Map<string, bigint>()
    for (const row of overdueRows) openByInvoiceId.set(row.id, BigInt(row.total))

    return {
      listRow,
      aggregate: aggregates.get(listRow.number),
      salesDocs,
      purchaseDocs,
      openByInvoiceId,
    }
  }, [contact, invoices, purchases, overdue])

  if (!contact.ok) {
    return <ContactLoadError detail={contact.problem.detail} />
  }

  const showPhoneCard = edit !== true

  return (
    <>
      {showPhoneCard && phoneLayout && cardData !== null && (
        <PhoneContactCard
          contact={cardData.listRow}
          aggregate={cardData.aggregate}
          salesDocs={cardData.salesDocs}
          purchaseDocs={cardData.purchaseDocs}
          openByInvoiceId={cardData.openByInvoiceId}
          asOf={asOf}
          onErased={() => {
            void router.invalidate()
          }}
        />
      )}

      {edit === true && phoneLayout && (
        <ContactEditForm
          contact={contact.data}
          contactId={contactId}
          layout="phone"
          onSaved={() => {
            void router.invalidate()
          }}
        />
      )}

      {!phoneLayout && (
        <ContactEditForm
          contact={contact.data}
          contactId={contactId}
          layout="desktop"
          onSaved={() => {
            void router.invalidate()
          }}
        />
      )}
    </>
  )
}

function ContactLoadError({ detail }: { detail: string }) {
  const { t } = useT()
  return (
    <>
      <PageHeader title={t('contact.title')} />
      <p role="alert" className="text-destructive text-sm">
        {detail}
      </p>
    </>
  )
}

function ContactEditForm({
  contact,
  contactId,
  layout,
  onSaved,
}: {
  contact: {
    readonly contact: {
      readonly number: string
      readonly name: string
      readonly legalName: string | null
      readonly isCustomer: boolean
      readonly isSupplier: boolean
      readonly isBlocked: boolean
      readonly email: string | null
      readonly phone: string | null
      readonly vatNumber: string | null
      readonly kvkNumber: string | null
      readonly countryCode: string
      readonly paymentTermsDays: number
      readonly iban: string | null
      readonly address: {
        readonly street: string | null
        readonly houseNumber: string | null
        readonly postalCode: string | null
        readonly city: string | null
      } | null
    }
    readonly openDocuments: { readonly sales: number; readonly purchase: number }
    readonly canErase: boolean
  }
  contactId: string
  layout: 'desktop' | 'phone'
  onSaved: () => void
}) {
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural } = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const key = useRef(crypto.randomUUID())

  const row = contact.contact
  const open = contact.openDocuments

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }
    const orNull = (name: string): string | null => (text(name) === '' ? null : text(name))

    setBusy(true)
    setError(null)
    setSaved(false)
    setFieldErrors({})

    const result = await updateContact({
      data: {
        contactId,
        idempotencyKey: key.current,
        number: text('number'),
        name: text('name'),
        legalName: orNull('legalName'),
        isCustomer: form.get('isCustomer') !== null,
        isSupplier: form.get('isSupplier') !== null,
        isBlocked: form.get('isBlocked') !== null,
        email: orNull('email'),
        phone: orNull('phone'),
        vatNumber: orNull('vatNumber'),
        kvkNumber: orNull('kvkNumber'),
        countryCode: text('countryCode') === '' ? 'NL' : text('countryCode').toUpperCase(),
        paymentTermsDays: text('paymentTermsDays') === '' ? 30 : Number(text('paymentTermsDays')),
        iban: orNull('iban'),
        address: {
          street: orNull('street'),
          houseNumber: orNull('houseNumber'),
          postalCode: orNull('postalCode'),
          city: orNull('city'),
          countryCode: text('countryCode') === '' ? 'NL' : text('countryCode').toUpperCase(),
        },
      },
    })

    setBusy(false)

    if (!result.ok) {
      const byField: Record<string, string> = {}
      for (const item of result.problem.violations) {
        if (item.path !== null) byField[item.path] = item.message
      }
      setFieldErrors(byField)
      setError(Object.keys(byField).length > 0 ? null : result.problem.detail)
      return
    }

    key.current = crypto.randomUUID()
    setSaved(true)
    onSaved()
  }

  const field = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <label
        htmlFor={`${layout}-${name}`}
        className="text-muted-foreground mb-1 block text-xs font-medium"
      >
        {label}
      </label>
      <Input
        id={`${layout}-${name}`}
        name={name}
        aria-describedby={fieldErrors[name] === undefined ? undefined : `${layout}-${name}-error`}
        {...props}
      />
      {fieldErrors[name] !== undefined && (
        <p id={`${layout}-${name}-error`} role="alert" className="text-destructive mt-1 text-xs">
          {fieldErrors[name]}
        </p>
      )}
    </div>
  )

  const formBody = (
    <>
      {(open.sales > 0 || open.purchase > 0) && (
        <p className="text-muted-foreground mb-6 text-sm">
          {t('contact.stillOpen')}{' '}
          {[
            open.sales > 0 ? plural('contact.openSales', open.sales) : null,
            open.purchase > 0 ? plural('contact.openPurchase', open.purchase) : null,
          ]
            .filter((value) => value !== null)
            .join(t('contact.and'))}
          {t('contact.stillOpenNote')}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="border-border bg-surface max-w-4xl space-y-4 rounded-[var(--radius-xl)] border p-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {field('number', t('contacts.numberLabel'), {
            required: true,
            defaultValue: row.number,
          })}
          {field('name', t('contacts.name'), { required: true, defaultValue: row.name })}
          {field('legalName', t('contacts.legalName'), { defaultValue: row.legalName ?? '' })}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {field('vatNumber', t('contacts.vatNumber'), { defaultValue: row.vatNumber ?? '' })}
          {field('kvkNumber', t('contacts.kvkNumber'), { defaultValue: row.kvkNumber ?? '' })}
          {field('email', t('contacts.email'), { type: 'email', defaultValue: row.email ?? '' })}
          {field('phone', t('contacts.phone'), { defaultValue: row.phone ?? '' })}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_7rem_7rem_1fr_5rem]">
          {field('street', t('contacts.street'), { defaultValue: row.address?.street ?? '' })}
          {field('houseNumber', t('contacts.houseNumber'), {
            defaultValue: row.address?.houseNumber ?? '',
          })}
          {field('postalCode', t('contacts.postalCode'), {
            defaultValue: row.address?.postalCode ?? '',
          })}
          {field('city', t('contacts.city'), { defaultValue: row.address?.city ?? '' })}
          {field('countryCode', t('contacts.country'), {
            defaultValue: row.countryCode,
            maxLength: 2,
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_10rem]">
          {field('iban', 'IBAN', {
            defaultValue: row.iban ?? '',
            placeholder: 'NL02INGB0999999999',
          })}
          {field('paymentTermsDays', t('contacts.paymentTerms'), {
            defaultValue: String(row.paymentTermsDays),
            inputMode: 'numeric',
          })}
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10">
            <input type="checkbox" name="isCustomer" defaultChecked={row.isCustomer} />
            {t('contacts.customerLabel')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10">
            <input type="checkbox" name="isSupplier" defaultChecked={row.isSupplier} />
            {t('contacts.supplierLabel')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10">
            <input type="checkbox" name="isBlocked" defaultChecked={row.isBlocked} />
            {t('contact.blocked')}
          </label>
        </div>

        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {saved && <p className="text-sm">{t('contact.saved')}</p>}

        <Button type="submit" className="min-h-11 md:min-h-10" disabled={busy || !hydrated}>
          {busy ? t('common.busy') : t('common.save')}
        </Button>
      </form>

      {contact.canErase && layout === 'desktop' && (
        <Erase
          contactId={contactId}
          open={open.sales + open.purchase}
          onErased={() => {
            void router.invalidate()
          }}
        />
      )}
    </>
  )

  if (layout === 'phone') {
    return (
      <div className="flex flex-col gap-4">
        <Button asChild variant="ghost" className="min-h-11 self-start px-2">
          <Link to="/contacts/$contactId" params={{ contactId }}>
            {t('contacts.phoneBack')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{row.name}</h1>
        {formBody}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title={`${row.number} · ${row.name}`}
        description={t('contact.intro')}
        actions={
          <Button asChild variant="outline">
            <Link to="/contacts">{t('contact.back')}</Link>
          </Button>
        }
      />
      {formBody}
    </>
  )
}

function Erase({
  contactId,
  open,
  onErased,
}: {
  contactId: string
  open: number
  onErased: () => void
}) {
  const hydrated = useHydrated()
  const { t, plural } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
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

  return (
    <section className="border-border bg-surface-sunken mt-10 max-w-2xl rounded-[var(--radius-xl)] border p-4">
      <h2 className="text-sm font-semibold">{t('erase.title')}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('erase.intro')}</p>

      <p className="text-muted-foreground mt-3 text-xs">
        <strong className="text-foreground font-medium">{t('erase.keptTitle')}</strong>{' '}
        {t('erase.kept')}
      </p>

      {open > 0 ? (
        <p className="text-unreconciled mt-3 text-sm">{plural('erase.blockedByOpen', open)}</p>
      ) : (
        <form onSubmit={(event) => void erase(event)} className="mt-4 space-y-3">
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

          <Button type="submit" variant="destructive" disabled={busy || !hydrated}>
            {busy ? t('common.busy') : t('erase.action')}
          </Button>
        </form>
      )}
    </section>
  )
}
