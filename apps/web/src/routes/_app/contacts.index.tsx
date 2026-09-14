import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { createContact, listContacts } from '~/server/sales'

/**
 * Relaties — customers and suppliers.
 *
 * The address fields are here rather than behind a second step because they are
 * not optional in practice: EN 16931 makes the buyer's postal address mandatory
 * on an invoice, so a customer recorded without one produces an invoice that is
 * refused at the point it matters most. Better to ask once, now.
 */
export const Route = createFileRoute('/_app/contacts/')({
  loader: async () => ({ contacts: await listContacts({ data: {} }) }),
  component: Contacts,
})

interface Row {
  id: string
  number: string
  name: string
  isCustomer: boolean
  isSupplier: boolean
  email: string | null
  vatNumber: string | null
  countryCode: string
  paymentTermsDays: number
  isBlocked: boolean
}

function Contacts() {
  const { contacts } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const idempotencyKey = useRef<string>(crypto.randomUUID())

  if (!contacts.ok) {
    return (
      <>
        <PageHeader title={t('contacts.title')} />
        <p role="alert" className="text-destructive text-sm">
          {contacts.problem.detail}
        </p>
      </>
    )
  }

  const rows = contacts.data.contacts

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (key: string): string => {
      const value = form.get(key)
      return typeof value === 'string' ? value.trim() : ''
    }
    const orNull = (key: string): string | null => (text(key) === '' ? null : text(key))

    setBusy(true)
    setError(null)
    setFieldErrors({})

    const result = await createContact({
      data: {
        idempotencyKey: idempotencyKey.current,
        number: text('number'),
        name: text('name'),
        legalName: orNull('legalName'),
        isCustomer: form.get('isCustomer') !== null,
        isSupplier: form.get('isSupplier') !== null,
        email: orNull('email'),
        phone: orNull('phone'),
        vatNumber: orNull('vatNumber'),
        kvkNumber: orNull('kvkNumber'),
        countryCode: text('countryCode') === '' ? 'NL' : text('countryCode').toUpperCase(),
        // Where a payment run sends the money. It was on the screen and not in
        // the payload, so every IBAN typed here was quietly thrown away and no
        // supplier could be paid.
        iban: orNull('iban'),
        paymentTermsDays: text('paymentTermsDays') === '' ? 30 : Number(text('paymentTermsDays')),
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
        if (item.path !== null) byField[item.path] = violationMessage(t, item)
      }
      setFieldErrors(byField)
      setError(Object.keys(byField).length > 0 ? null : result.problem.detail)
      return
    }

    idempotencyKey.current = crypto.randomUUID()
    setOpen(false)
    await router.invalidate()
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'number',
      header: t('contacts.number'),
      width: '8rem',
      cell: (row) => <span className="tabular">{row.number}</span>,
    },
    {
      key: 'name',
      header: t('contacts.name'),
      // A link rather than a row click, because "open this to correct it" is
      // navigation and a link is what a keyboard, a middle click and a screen
      // reader all already understand.
      cell: (row) => (
        <Link
          to="/contacts/$contactId"
          params={{ contactId: row.id }}
          className={row.isBlocked ? 'text-muted-foreground underline line-through' : 'underline'}
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'role',
      header: t('contacts.role'),
      width: '10rem',
      cell: (row) =>
        [
          row.isCustomer ? t('contacts.customer') : null,
          row.isSupplier ? t('contacts.supplier') : null,
        ]
          .filter((value) => value !== null)
          .join(', '),
    },
    {
      key: 'vat',
      header: t('contacts.vatNumber'),
      width: '11rem',
      cell: (row) => row.vatNumber ?? '',
    },
    {
      key: 'country',
      header: t('contacts.country'),
      width: '4rem',
      cell: (row) => row.countryCode,
    },
    {
      key: 'terms',
      header: t('contacts.terms'),
      width: '6rem',
      align: 'right',
      cell: (row) => <span className="tabular">{row.paymentTermsDays} d</span>,
    },
  ]

  const field = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <label htmlFor={name} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-describedby={fieldErrors[name] === undefined ? undefined : `${name}-error`}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        {...props}
      />
      {fieldErrors[name] !== undefined && (
        <p id={`${name}-error`} role="alert" className="text-destructive mt-1 text-xs">
          {fieldErrors[name]}
        </p>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title={t('contacts.title')}
        description={t('contacts.intro')}
        actions={
          <button
            type="button"
            disabled={!hydrated}
            onClick={() => {
              setOpen((value) => !value)
            }}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {open ? t('common.cancel') : t('contacts.new')}
          </button>
        }
      />

      {open && (
        <form
          onSubmit={(event) => {
            void submit(event)
          }}
          className="border-border mb-8 space-y-4 rounded-md border p-4"
        >
          <div className="grid grid-cols-3 gap-4">
            {field('number', t('contacts.numberLabel'), {
              required: true,
              placeholder: 'DEB-0001',
            })}
            {field('name', t('contacts.name'), {
              required: true,
              placeholder: t('contacts.namePlaceholder'),
            })}
            {field('legalName', t('contacts.legalName'))}
          </div>

          <div className="grid grid-cols-4 gap-4">
            {field('vatNumber', t('contacts.vatNumber'), { placeholder: 'NL123456789B01' })}
            {field('kvkNumber', t('contacts.kvkNumber'))}
            {field('email', t('contacts.email'), { type: 'email' })}
            {field('phone', t('contacts.phone'))}
          </div>

          <div className="grid grid-cols-[1fr_7rem_7rem_1fr_5rem] gap-4">
            {field('street', t('contacts.street'))}
            {field('houseNumber', t('contacts.houseNumber'))}
            {field('postalCode', t('contacts.postalCode'))}
            {field('city', t('contacts.city'))}
            {field('countryCode', t('contacts.country'), { defaultValue: 'NL', maxLength: 2 })}
            {field('iban', 'IBAN', { placeholder: 'NL02ABNA0123456789' })}
          </div>

          <div className="flex items-end gap-6">
            <div className="w-40">
              {field('paymentTermsDays', t('contacts.paymentTerms'), {
                defaultValue: '30',
                inputMode: 'numeric',
              })}
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="isCustomer" defaultChecked />
              {t('contacts.customerLabel')}
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="isSupplier" />
              {t('contacts.supplierLabel')}
            </label>
          </div>

          {error !== null && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !hydrated}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? t('common.busy') : t('common.save')}
          </button>
        </form>
      )}

      <LedgerTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        caption={t('contacts.title')}
        empty={t('contacts.empty')}
      />
    </>
  )
}
