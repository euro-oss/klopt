import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { useHydrated } from '~/lib/hydration'
import { getEntity, updateEntity } from '~/server/entity'

/**
 * The administration's own details.
 *
 * These are the fields a UBL invoice cannot be generated without (spec 7.5),
 * and the reason the setup form was right not to ask for them: an
 * administration is a useful shadow ledger long before anybody invoices out of
 * it, and putting eleven fields in front of somebody on day one to satisfy a
 * rule they will meet in month three is how a setup form becomes a wall.
 *
 * So the promise the setup screen makes — "de rest kun je later nog wijzigen" —
 * is kept here.
 */
export const Route = createFileRoute('/_app/settings')({
  loader: async () => ({ entity: await getEntity() }),
  component: Settings,
})

const SCHEMES = [
  { value: '', label: 'Automatisch (KvK-nummer)' },
  { value: '0106', label: '0106 — KvK-nummer' },
  { value: '0190', label: '0190 — OIN' },
  { value: '9944', label: '9944 — btw-nummer' },
] as const

function Settings() {
  const { entity } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  if (!entity.ok) {
    return (
      <>
        <PageHeader title="Instellingen" />
        <p role="alert" className="text-destructive text-sm">
          {entity.problem.detail}
        </p>
      </>
    )
  }

  const current = entity.data

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
    setNotice(null)
    setFieldErrors({})

    const result = await updateEntity({
      data: {
        name: text('name'),
        legalName: text('legalName'),
        kvkNumber: orNull('kvkNumber'),
        vatNumber: orNull('vatNumber'),
        street: orNull('street'),
        houseNumber: orNull('houseNumber'),
        postalCode: orNull('postalCode'),
        city: orNull('city'),
        countryCode: text('countryCode'),
        email: orNull('email'),
        phone: orNull('phone'),
        website: orNull('website'),
        iban: orNull('iban'),
        bic: orNull('bic'),
        electronicAddress: orNull('electronicAddress'),
        electronicAddressScheme: orNull('electronicAddressScheme'),
        vatRounding: text('vatRounding') === 'per_line' ? 'per_line' : 'per_invoice',
      },
    })

    setBusy(false)

    if (!result.ok) {
      const byField: Record<string, string> = {}
      for (const item of result.problem.violations) {
        if (item.path !== null) byField[item.path] = item.message
      }
      setFieldErrors(byField)
      // Only summarise when there is nothing to put next to a field. The same
      // message in two places reads as two problems.
      setError(Object.keys(byField).length > 0 ? null : result.problem.detail)
      return
    }

    setNotice('Opgeslagen.')
    await router.invalidate()
  }

  /**
   * A labelled input.
   *
   * The hint and the error sit **outside** the `<label>` and are attached with
   * `aria-describedby`. Anything inside a label becomes part of the control's
   * accessible name, so the obvious markup makes a screen reader announce the
   * field as "KvK-nummer Acht cijfers." — and, once something is wrong, as the
   * label plus the entire error message.
   */
  const field = (
    name: string,
    label: string,
    value: string | null,
    hint?: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const described = [
      hint === undefined ? null : `${name}-hint`,
      fieldErrors[name] === undefined ? null : `${name}-error`,
    ]
      .filter((id): id is string => id !== null)
      .join(' ')

    return (
      <div>
        <label htmlFor={name} className="text-muted-foreground mb-1 block text-xs font-medium">
          {label}
        </label>
        <input
          id={name}
          name={name}
          defaultValue={value ?? ''}
          aria-describedby={described === '' ? undefined : described}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          {...props}
        />
        {hint !== undefined && (
          <p id={`${name}-hint`} className="text-muted-foreground mt-1 text-xs">
            {hint}
          </p>
        )}
        {fieldErrors[name] !== undefined && (
          <p id={`${name}-error`} role="alert" className="text-destructive mt-1 text-xs">
            {fieldErrors[name]}
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Instellingen"
        description="De gegevens van deze administratie. Een e-factuur kan niet zonder."
      />

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="max-w-2xl space-y-6"
      >
        <fieldset className="space-y-4">
          <legend className="text-base font-medium">Naam en registratie</legend>
          <div className="grid grid-cols-2 gap-4">
            {field('name', 'Handelsnaam', current.name)}
            {field('legalName', 'Statutaire naam', current.legalName)}
            {field('kvkNumber', 'KvK-nummer', current.kvkNumber, 'Acht cijfers.')}
            {field('vatNumber', 'Btw-nummer', current.vatNumber, 'Bijvoorbeeld NL123456789B01.')}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">Adres</legend>
          <div className="grid grid-cols-[1fr_8rem] gap-4">
            {field('street', 'Straat', current.street)}
            {field('houseNumber', 'Huisnummer', current.houseNumber)}
          </div>
          <div className="grid grid-cols-[8rem_1fr_6rem] gap-4">
            {field('postalCode', 'Postcode', current.postalCode)}
            {field('city', 'Plaats', current.city)}
            {field('countryCode', 'Land', current.countryCode, undefined, { maxLength: 2 })}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">Contact en betaling</legend>
          <div className="grid grid-cols-2 gap-4">
            {field('email', 'E-mail', current.email, undefined, { type: 'email' })}
            {field('phone', 'Telefoon', current.phone)}
            {field('iban', 'IBAN', current.iban, 'Komt op de factuur als betaalinstructie.')}
            {field('bic', 'BIC', current.bic)}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">E-facturatie</legend>
          <p className="text-muted-foreground text-sm">
            Het elektronische adres waarop deze administratie te bereiken is. Peppol vereist het,
            ook als je de factuur per e-mail verstuurt.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {field(
              'electronicAddress',
              'Elektronisch adres',
              current.electronicAddress,
              'Leeg laten om het KvK-nummer te gebruiken.',
            )}
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">Schema</span>
              <select
                name="electronicAddressScheme"
                defaultValue={current.electronicAddressScheme ?? ''}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                {SCHEMES.map((scheme) => (
                  <option key={scheme.value} value={scheme.value}>
                    {scheme.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">Btw-afronding</legend>
          <p className="text-muted-foreground text-sm">
            Per factuur of per regel. De twee geven andere uitkomsten — drie regels van 33,33 bij
            21% worden 7,00 per regel en 6,99 op het totaal — en dit is een keuze, geen detail.
          </p>
          <label className="block max-w-xs">
            <span className="sr-only">Btw-afronding</span>
            <select
              name="vatRounding"
              defaultValue={current.vatRounding}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="per_invoice">Per factuur</option>
              <option value="per_line">Per regel</option>
            </select>
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={busy || !hydrated}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Bezig…' : 'Opslaan'}
        </button>
      </form>
    </>
  )
}
