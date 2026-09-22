import { createFileRoute, useRouter } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { AccountPicker } from '~/components/finance/account-picker'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { listAccounts } from '~/server/ledger'
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
  loader: async () => ({ entity: await getEntity(), accounts: await listAccounts() }),
  component: Settings,
})

const SCHEMES = [
  { value: '', key: 'settings.scheme.auto' },
  { value: '0106', key: 'settings.scheme.0106' },
  { value: '0190', key: 'settings.scheme.0190' },
  { value: '9944', key: 'settings.scheme.9944' },
] as const satisfies readonly { value: string; key: MessageKey }[]

function Settings() {
  const { entity, accounts } = Route.useLoaderData()
  // Costs only: bank charges are a cost, and offering the whole chart here is
  // offering ninety wrong answers alongside the right one.
  const expenseAccounts = accounts.ok
    ? accounts.data.accounts.filter((account) => account.type === 'expense')
    : []
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  if (!entity.ok) {
    return (
      <>
        <PageHeader title={t('settings.title')} />
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
        bankChargesAccountNumber: orNull('bankChargesAccountNumber'),
      },
    })

    setBusy(false)

    if (!result.ok) {
      const byField: Record<string, string> = {}
      for (const item of result.problem.violations) {
        if (item.path !== null) byField[item.path] = violationMessage(t, item)
      }
      setFieldErrors(byField)
      // Only summarise when there is nothing to put next to a field. The same
      // message in two places reads as two problems.
      setError(Object.keys(byField).length > 0 ? null : result.problem.detail)
      return
    }

    setNotice(t('settings.saved'))
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
      <PageHeader title={t('settings.title')} description={t('settings.intro')} />

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
        className="max-w-2xl space-y-4"
      >
        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.registration')}</legend>
          <div className="grid grid-cols-2 gap-3">
            {field('name', t('settings.tradeName'), current.name)}
            {field('legalName', t('contacts.legalName'), current.legalName)}
            {field('kvkNumber', t('contacts.kvkNumber'), current.kvkNumber, t('settings.kvkHint'))}
            {field('vatNumber', t('contacts.vatNumber'), current.vatNumber, t('settings.vatHint'))}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.address')}</legend>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            {field('street', t('contacts.street'), current.street)}
            {field('houseNumber', t('settings.houseNumber'), current.houseNumber)}
          </div>
          <div className="grid grid-cols-[8rem_1fr_6rem] gap-3">
            {field('postalCode', t('contacts.postalCode'), current.postalCode)}
            {field('city', t('contacts.city'), current.city)}
            {field('countryCode', t('contacts.country'), current.countryCode, undefined, {
              maxLength: 2,
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.contactAndPayment')}</legend>
          <div className="grid grid-cols-2 gap-3">
            {field('email', t('contacts.email'), current.email, undefined, { type: 'email' })}
            {field('phone', t('contacts.phone'), current.phone)}
            {field('iban', 'IBAN', current.iban, t('settings.ibanHint'))}
            {field('bic', 'BIC', current.bic)}
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.eInvoicing')}</legend>
          <p className="text-muted-foreground text-sm">{t('settings.eInvoicingIntro')}</p>
          <div className="grid grid-cols-2 gap-3">
            {field(
              'electronicAddress',
              t('settings.electronicAddress'),
              current.electronicAddress,
              t('settings.electronicAddressHint'),
            )}
            <SelectField
              label={t('settings.scheme')}
              name="electronicAddressScheme"
              defaultValue={current.electronicAddressScheme ?? ''}
              disabled={!hydrated}
            >
              {SCHEMES.map((scheme) => (
                <SelectOption key={scheme.value} value={scheme.value}>
                  {t(scheme.key)}
                </SelectOption>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.vatRounding')}</legend>
          <p className="text-muted-foreground text-sm">{t('settings.vatRoundingIntro')}</p>
          <SelectField
            label={t('settings.vatRounding')}
            labelHidden
            name="vatRounding"
            defaultValue={current.vatRounding}
            disabled={!hydrated}
            className="max-w-xs"
          >
            <SelectOption value="per_invoice">{t('settings.perInvoice')}</SelectOption>
            <SelectOption value="per_line">{t('settings.perLine')}</SelectOption>
          </SelectField>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-base font-medium">{t('settings.bankCharges')}</legend>
          <p className="text-muted-foreground text-sm">{t('settings.bankChargesIntro')}</p>
          <AccountPicker
            label={t('settings.bankChargesAccount')}
            labelHidden
            name="bankChargesAccountNumber"
            accounts={expenseAccounts}
            defaultValue={current.bankChargesAccountNumber ?? ''}
            disabled={!hydrated}
            emptyOption={t('settings.bankChargesNone')}
            className="max-w-md"
          />
        </fieldset>

        <button
          type="submit"
          disabled={busy || !hydrated}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('common.save')}
        </button>
      </form>
    </>
  )
}
