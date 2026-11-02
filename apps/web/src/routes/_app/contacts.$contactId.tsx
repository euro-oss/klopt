import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { getContact, pseudonymiseContact, updateContact } from '~/server/sales'

/**
 * Correcting a relatie (#130 — edit surface for the Contacts card).
 *
 * Master data is corrected in place. There is no journal here to keep honest,
 * and everything already booked points at this row by id — so fixing a mistyped
 * IBAN fixes the next betaalrun without touching a cent of what happened
 * before. What was *sent* does not move: an issued invoice's UBL and PDF are
 * stored artefacts, and a name corrected today does not rewrite them.
 *
 * The screen sends the whole form rather than only what changed, which is fine
 * because a contact is edited by one person at a time — but the API takes a
 * patch, because a machine correcting one field should not have to know the
 * other fifteen.
 *
 * Erasure stays behind `retention:manage`, separate from edit (design + #107).
 */
export const Route = createFileRoute('/_app/contacts/$contactId')({
  loader: async ({ params }) => ({
    contact: await getContact({ data: { contactId: params.contactId } }),
  }),
  component: EditContact,
})

function EditContact() {
  const { contact } = Route.useLoaderData()
  const { contactId } = Route.useParams()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, plural } = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const key = useRef(crypto.randomUUID())

  if (!contact.ok) {
    return (
      <>
        <PageHeader title={t('contact.title')} />
        <p role="alert" className="text-destructive text-sm">
          {contact.problem.detail}
        </p>
      </>
    )
  }

  const row = contact.data.contact
  const open = contact.data.openDocuments

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
    await router.invalidate()
  }

  const field = (
    name: string,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div>
      <label htmlFor={name} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <Input
        id={name}
        name={name}
        aria-describedby={fieldErrors[name] === undefined ? undefined : `${name}-error`}
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
        title={`${row.number} · ${row.name}`}
        description={t('contact.intro')}
        actions={
          <Button asChild variant="outline">
            <Link to="/contacts">{t('contact.back')}</Link>
          </Button>
        }
      />

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
            placeholder: 'NL02ABNA0123456789',
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

        <Button type="submit" disabled={busy || !hydrated}>
          {busy ? t('common.busy') : t('common.save')}
        </Button>
      </form>

      {contact.data.canErase && (
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
}

/**
 * Answering a right-to-erasure request (spec 7.6).
 *
 * At the bottom of the contact, behind its own heading and its own reason
 * field, because it is not an edit. Editing a contact corrects what we know;
 * this destroys it, and the two should not sit in the same form where a stray
 * submit reaches the wrong one.
 *
 * Shown only when the caller holds `retention:manage` — the server says so
 * rather than the screen inferring it from a role — on the same principle as
 * the navigation: do not offer an action that will answer 403.
 */
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
