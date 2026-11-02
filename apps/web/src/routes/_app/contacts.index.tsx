import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Plus, Search, Shield } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { violationMessage } from '~/i18n/labels'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import {
  aggregateContacts,
  CONTACTS_DOCS_FETCH_LIMIT,
  contactInitials,
  contactRoleLabel,
  countContactRoles,
  filterContacts,
  missingEInvoicingDetails,
  parseContactsRoleFilter,
  salesDocStatus,
  supplierOpenSummary,
  type ContactListRow,
  type ContactPurchaseDoc,
  type ContactsRoleFilter,
  type ContactSalesDoc,
} from '~/lib/contacts-list'
import { formatMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import { cn } from '~/lib/utils'
import { listPurchaseInvoices } from '~/server/purchase'
import {
  createContact,
  getContact,
  listContacts,
  listInvoices,
  listOverdueInvoices,
  pseudonymiseContact,
} from '~/server/sales'

/**
 * Contacts — list + card (#107 Phase 6 / #130).
 *
 * Board: `Contacts` at `fa4093b` (desktop light). Dark and phone use tokens /
 * existing patterns until Batch 2/3 boards. Filters All / Customers /
 * Suppliers (`1`–`3`), `/` filter, `j`/`k` + Space/X select, `E` edit, `N F`
 * new invoice for customers. Create stays on this page (`N C` chord navigates
 * here; the button opens the form).
 */

const ROLE_ORDER: readonly ContactsRoleFilter[] = ['all', 'customers', 'suppliers']

export const Route = createFileRoute('/_app/contacts/')({
  // Optional search so shell / ⌘K / guided-invoice Links to `/contacts` stay
  // valid without every caller passing role/q/id.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    role?: ContactsRoleFilter
    q?: string
    id?: string
    new?: boolean
  } => {
    const role = parseContactsRoleFilter(search['role'])
    const q = typeof search['q'] === 'string' ? search['q'] : ''
    const id = typeof search['id'] === 'string' && search['id'] !== '' ? search['id'] : undefined
    const isNew = search['new'] === true || search['new'] === '1' || search['new'] === 'true'
    return {
      ...(role !== 'all' ? { role } : {}),
      ...(q !== '' ? { q } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(isNew ? { new: true } : {}),
    }
  },
  loader: async () => {
    const asOf = localTodayIso()
    const [contacts, invoices, purchases, overdue] = await Promise.all([
      listContacts({ data: {} }),
      listInvoices({ data: { status: null, limit: CONTACTS_DOCS_FETCH_LIMIT } }),
      listPurchaseInvoices({ data: {} }),
      listOverdueInvoices({ data: { asOf } }),
    ])
    return { contacts, invoices, purchases, overdue, asOf }
  },
  pendingComponent: ContactsPending,
  component: Contacts,
})

function ContactsPending() {
  const { t } = useT()
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t('common.busy')}</p>
      <div className="bg-muted h-10 w-48 animate-pulse rounded-[var(--radius-md)]" />
      <div className="bg-muted h-64 animate-pulse rounded-[var(--radius-xl)]" />
    </div>
  )
}

function Contacts() {
  const { contacts: result, invoices, purchases, overdue, asOf } = Route.useLoaderData()
  const search = Route.useSearch()
  const role: ContactsRoleFilter = search.role ?? 'all'
  const q = search.q ?? ''
  const selectedId = search.id
  const openNew = search.new === true
  const navigate = useNavigate()
  const router = useRouter()
  const { t } = useT()
  const hydrated = useHydrated()
  const filterRef = useRef<HTMLInputElement | null>(null)

  const [manualCreate, setManualCreate] = useState(false)
  const creating = openNew || manualCreate

  const contactsSearch = useCallback(
    (patch: {
      role?: ContactsRoleFilter
      q?: string
      id?: string | undefined
      new?: boolean
    }): {
      role?: ContactsRoleFilter
      q?: string
      id?: string
      new?: boolean
    } => {
      const nextRole = patch.role ?? role
      const nextQ = patch.q ?? q
      const nextId = patch.id !== undefined ? patch.id : selectedId
      const nextNew = patch.new ?? false
      return {
        ...(nextRole !== 'all' ? { role: nextRole } : {}),
        ...(nextQ !== '' ? { q: nextQ } : {}),
        ...(nextId !== undefined && nextId !== '' ? { id: nextId } : {}),
        ...(nextNew ? { new: true } : {}),
      }
    },
    [role, q, selectedId],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const idempotencyKey = useRef<string>(crypto.randomUUID())

  const rows: readonly ContactListRow[] = useMemo(
    () => (result.ok ? result.data.contacts : []),
    [result],
  )
  const salesDocs: readonly ContactSalesDoc[] = useMemo(() => {
    if (!invoices.ok) return []
    return invoices.data.invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      total: invoice.total,
      contactNumber: invoice.contactNumber,
      status: invoice.status,
      kind: invoice.kind,
      dueDate: invoice.dueDate,
    }))
  }, [invoices])
  const purchaseDocs = useMemo(() => (purchases.ok ? purchases.data.invoices : []), [purchases])
  const overdueRows = useMemo(() => (overdue.ok ? overdue.data.invoices : []), [overdue])

  /** Outstanding by invoice id from the overdue report (issued + past due). */
  const openByInvoiceId = useMemo(() => {
    const map = new Map<string, bigint>()
    for (const row of overdueRows) map.set(row.id, BigInt(row.total))
    return map
  }, [overdueRows])

  const aggregates = useMemo(
    () =>
      aggregateContacts(
        rows,
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
      ),
    [rows, salesDocs, purchaseDocs, overdueRows],
  )

  const counts = countContactRoles(rows)
  const shown = filterContacts(rows, role, q)

  const activeId =
    selectedId !== undefined && shown.some((row) => row.id === selectedId) ? selectedId : undefined
  const active = activeId === undefined ? undefined : shown.find((row) => row.id === activeId)

  useEffect(() => {
    if (!hydrated || !result.ok) return

    const moveSelection = (delta: 1 | -1): void => {
      if (shown.length === 0) return
      const index = activeId === undefined ? -1 : shown.findIndex((row) => row.id === activeId)
      const nextIndex =
        activeId === undefined
          ? delta > 0
            ? 0
            : shown.length - 1
          : Math.min(Math.max(index + delta, 0), shown.length - 1)
      const next = shown[nextIndex]
      if (next === undefined) return
      void navigate({
        to: '/contacts',
        search: contactsSearch({ id: next.id, new: false }),
      })
    }

    const selectCurrent = (): void => {
      if (activeId !== undefined) return
      const first = shown[0]
      if (first === undefined) return
      void navigate({
        to: '/contacts',
        search: contactsSearch({ id: first.id, new: false }),
      })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (isTypingInto(event.target)) {
        if (event.key === 'Escape') {
          ;(event.target as HTMLElement).blur()
          event.preventDefault()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        if (creating) {
          event.preventDefault()
          setManualCreate(false)
          if (openNew) {
            void navigate({ to: '/contacts', search: contactsSearch({ new: false }) })
          }
          return
        }
        if (selectedId !== undefined) {
          event.preventDefault()
          void navigate({
            to: '/contacts',
            search: contactsSearch({ id: '', new: false }),
          })
        }
        return
      }

      const digit = Number(event.key)
      if (digit >= 1 && digit <= 3) {
        const next = ROLE_ORDER[digit - 1]
        if (next === undefined) return
        event.preventDefault()
        void navigate({
          to: '/contacts',
          search: contactsSearch({ role: next, new: false }),
        })
        return
      }

      if (event.key === 'j' || event.key === 'J' || event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1)
        return
      }
      if (event.key === 'k' || event.key === 'K' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1)
        return
      }

      if (event.key === ' ' || event.key === 'x' || event.key === 'X') {
        event.preventDefault()
        if (activeId === undefined) selectCurrent()
        return
      }

      if (event.key === 'e' || event.key === 'E') {
        if (activeId === undefined) return
        event.preventDefault()
        void navigate({ to: '/contacts/$contactId', params: { contactId: activeId } })
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    hydrated,
    result.ok,
    shown,
    activeId,
    selectedId,
    creating,
    openNew,
    contactsSearch,
    navigate,
  ])

  if (!result.ok) {
    return (
      <>
        <PageHeader title={t('contacts.title')} />
        <p role="alert" className="text-destructive text-sm">
          {result.problem.detail}
        </p>
      </>
    )
  }

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

    const created = await createContact({
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

    if (!created.ok) {
      const byField: Record<string, string> = {}
      for (const item of created.problem.violations) {
        if (item.path !== null) byField[item.path] = violationMessage(t, item)
      }
      setFieldErrors(byField)
      setError(Object.keys(byField).length > 0 ? null : created.problem.detail)
      return
    }

    idempotencyKey.current = crypto.randomUUID()
    setManualCreate(false)
    await router.invalidate()
    void navigate({
      to: '/contacts',
      search: contactsSearch({ id: created.data.id, new: false }),
    })
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

  const roleLabels = {
    customer: t('contacts.customerLabel'),
    supplier: t('contacts.supplierLabel'),
    both: t('contacts.roleBoth'),
  }

  return (
    <>
      <header className="mb-0 flex flex-wrap items-center gap-3 pt-1 md:pt-0">
        <h1 className="min-w-0 flex-1 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
          {t('contacts.title')}
        </h1>
        <label className="border-input bg-background focus-within:outline-ring relative flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 md:w-[260px] md:min-h-10">
          <Search className="text-ink-muted size-4 shrink-0" aria-hidden="true" />
          <Input
            ref={filterRef}
            data-list-filter=""
            value={q}
            onChange={(event) => {
              void navigate({
                to: '/contacts',
                search: contactsSearch({ q: event.target.value, new: false }),
                replace: true,
              })
            }}
            placeholder={t('contacts.filterPlaceholder')}
            aria-label={t('contacts.filterAria')}
            className="border-0 bg-transparent px-0 shadow-none focus-visible:outline-none"
            suppressHydrationWarning
          />
          {hydrated && (
            <span className="text-ink-muted absolute top-1/2 right-3 hidden -translate-y-1/2 md:inline">
              <Keycap>/</Keycap>
            </span>
          )}
        </label>
        <Button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            if (creating) {
              setManualCreate(false)
              if (openNew) {
                void navigate({ to: '/contacts', search: contactsSearch({ new: false }) })
              }
              return
            }
            setManualCreate(true)
          }}
          className="min-h-11 md:min-h-10"
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          {creating ? t('common.cancel') : t('contacts.new')}
          {hydrated && !creating && (
            <span className="ml-1 hidden gap-0.5 normal-case md:inline-flex">
              <Keycap className="bg-primary-foreground/15 text-primary-foreground">n</Keycap>
              <Keycap className="bg-primary-foreground/15 text-primary-foreground">c</Keycap>
            </span>
          )}
        </Button>
      </header>

      {creating && (
        <form
          onSubmit={(event) => {
            void submit(event)
          }}
          className="border-border bg-surface mt-4 space-y-4 rounded-[var(--radius-xl)] border p-4"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {field('vatNumber', t('contacts.vatNumber'), { placeholder: 'NL123456789B01' })}
            {field('kvkNumber', t('contacts.kvkNumber'))}
            {field('email', t('contacts.email'), { type: 'email' })}
            {field('phone', t('contacts.phone'))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_7rem_7rem_1fr_5rem]">
            {field('street', t('contacts.street'))}
            {field('houseNumber', t('contacts.houseNumber'))}
            {field('postalCode', t('contacts.postalCode'))}
            {field('city', t('contacts.city'))}
            {field('countryCode', t('contacts.country'), { defaultValue: 'NL', maxLength: 2 })}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_10rem]">
            {field('iban', 'IBAN', { placeholder: 'NL02ABNA0123456789' })}
            {field('paymentTermsDays', t('contacts.paymentTerms'), {
              defaultValue: '30',
              inputMode: 'numeric',
            })}
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10">
              <input type="checkbox" name="isCustomer" defaultChecked />
              {t('contacts.customerLabel')}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10">
              <input type="checkbox" name="isSupplier" />
              {t('contacts.supplierLabel')}
            </label>
          </div>

          {error !== null && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !hydrated}>
            {busy ? t('common.busy') : t('common.save')}
          </Button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-start gap-5">
        <section
          aria-label={t('contacts.list')}
          className="flex min-w-[min(100%,26rem)] flex-[1_1_440px] max-w-[620px] flex-col gap-3"
        >
          <Tabs
            value={role}
            onValueChange={(value) => {
              void navigate({
                to: '/contacts',
                search: contactsSearch({
                  role: parseContactsRoleFilter(value),
                  id: '',
                  new: false,
                }),
              })
            }}
          >
            <TabsList
              variant="segmented"
              aria-label={t('contacts.roleFilter')}
              className="w-full md:w-auto [&_[data-slot=tabs-trigger]]:min-h-11 md:[&_[data-slot=tabs-trigger]]:min-h-9"
            >
              {ROLE_ORDER.map((key) => (
                <TabsTrigger key={key} value={key} className="flex-1 gap-1.5 md:flex-none">
                  {t(`contacts.segment.${key}` as MessageKey)}
                  <span className="text-ink-muted tabular-nums">
                    {key === 'all'
                      ? String(counts.all)
                      : key === 'customers'
                        ? String(counts.customers)
                        : String(counts.suppliers)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {shown.length === 0 ? (
            <Empty className="rounded-[var(--radius-xl)] border">
              <EmptyHeader>
                <EmptyTitle>
                  {rows.length === 0 ? t('contacts.empty') : t('contacts.emptyFilter')}
                </EmptyTitle>
                {rows.length === 0 && <EmptyDescription>{t('contacts.intro')}</EmptyDescription>}
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-[var(--radius-xl)] border">
              {/* Desktop column headers only — phone rows are name-first, two lines. */}
              <div
                className="text-ink-muted hidden grid-cols-[36px_minmax(0,1fr)_4.75rem_6.5rem] gap-3 border-b border-[var(--line-soft)] px-5 py-2.5 text-xs font-medium md:grid"
                role="row"
              >
                <span aria-hidden="true" />
                <span>{t('contacts.name')}</span>
                <span>{t('contacts.role')}</span>
                <span className="text-right">{t('contacts.open')}</span>
              </div>
              <div className="max-h-[720px] overflow-y-auto">
                {shown.map((row) => {
                  const stats = aggregates.get(row.number)
                  const openMinor = stats?.openMinor ?? 0n
                  const isActive = row.id === activeId
                  const sub = row.email !== null && row.email !== '' ? row.email : row.number
                  const role = contactRoleLabel(row, roleLabels)
                  const openLabel =
                    openMinor > 0n ? (
                      <>
                        €&nbsp;
                        <Money amount={openMinor} />
                      </>
                    ) : (
                      '–'
                    )
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-selected={isActive}
                      onClick={() => {
                        // Phone: open the full contact. Desktop: select for the card.
                        if (window.matchMedia('(max-width: 767px)').matches) {
                          void navigate({
                            to: '/contacts/$contactId',
                            params: { contactId: row.id },
                          })
                          return
                        }
                        void navigate({
                          to: '/contacts',
                          search: contactsSearch({ id: row.id, new: false }),
                        })
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 border-b border-[var(--line-soft)] px-4 py-3 text-left last:border-b-0',
                        'md:grid md:grid-cols-[36px_minmax(0,1fr)_4.75rem_6.5rem] md:items-center md:gap-3 md:px-5',
                        'min-h-11 hover:bg-[var(--surface-hover)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                        isActive && 'bg-[var(--surface-hover)]',
                        row.isBlocked && 'opacity-70',
                      )}
                    >
                      <span
                        className="bg-surface-sunken text-ink-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        aria-hidden="true"
                      >
                        {contactInitials(row.name)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          data-contact-name=""
                          title={row.name}
                          className={cn(
                            'break-words font-medium',
                            row.isBlocked && 'text-muted-foreground line-through',
                          )}
                        >
                          {row.name}
                        </span>
                        <span className="text-ink-muted truncate text-xs" title={sub}>
                          {sub}
                        </span>
                        {/* Phone: role + open under the name so the name never yields width. */}
                        <span className="text-ink-2 flex justify-between gap-3 text-sm md:hidden">
                          <span className="min-w-0 truncate" title={role}>
                            {role}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 tabular-nums',
                              openMinor > 0n ? 'text-destructive font-semibold' : 'text-ink-muted',
                            )}
                          >
                            {openLabel}
                          </span>
                        </span>
                      </span>
                      <span className="text-ink-2 hidden truncate text-sm md:block" title={role}>
                        {role}
                      </span>
                      <span
                        className={cn(
                          'hidden self-center text-right tabular-nums md:block',
                          openMinor > 0n ? 'text-destructive font-semibold' : 'text-ink-muted',
                        )}
                      >
                        {openLabel}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {active !== undefined && (
          <ContactCard
            key={active.id}
            contact={active}
            aggregate={aggregates.get(active.number)}
            salesDocs={salesDocs.filter((doc) => doc.contactNumber === active.number)}
            purchaseDocs={purchaseDocs.filter((doc) => doc.contactNumber === active.number)}
            openByInvoiceId={openByInvoiceId}
            asOf={asOf}
            onErased={() => {
              void router.invalidate()
            }}
          />
        )}
      </div>

      <footer className="text-ink-muted mt-4 mb-6 hidden flex-wrap gap-x-5 gap-y-2 text-xs md:flex">
        <span className="inline-flex items-center gap-1.5">
          <Keycap>j</Keycap>
          <Keycap>k</Keycap>
          {t('contacts.hint.nav')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keycap>e</Keycap>
          {t('contacts.hint.edit')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keycap>n</Keycap>
          <Keycap>f</Keycap>
          {t('contacts.hint.invoice')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Keycap>1</Keycap>–<Keycap>3</Keycap>
          {t('contacts.hint.roles')}
        </span>
      </footer>
    </>
  )
}

function ContactCard({
  contact,
  aggregate,
  salesDocs,
  purchaseDocs,
  openByInvoiceId,
  asOf,
  onErased,
}: {
  contact: ContactListRow
  aggregate:
    | { volumeMinor: bigint; documentCount: number; openMinor: bigint; lateDays: number | null }
    | undefined
  salesDocs: readonly ContactSalesDoc[]
  purchaseDocs: readonly {
    id: string
    total: string
    outstanding: string
    dueDate: string
    status: string
    supplierInvoiceNumber: string
    contactNumber: string
  }[]
  openByInvoiceId: ReadonlyMap<string, bigint>
  asOf: string
  onErased: () => void
}) {
  const { t, plural } = useT()
  const hydrated = useHydrated()
  const year = asOf.slice(0, 4)
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
  // Remount via key={contact.id} on the parent resets detail; only async setState here.
  const [detail, setDetail] = useState<DetailState>(null)

  useEffect(() => {
    let cancelled = false
    void getContact({ data: { contactId: contact.id } }).then((result) => {
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
  }, [contact.id])

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

  // Purchase side only — open count/amount; overdue only when dueDate < asOf (#163 Legal).
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

  return (
    <aside
      aria-label={t('contacts.card')}
      className="border-border bg-surface hidden min-w-0 flex-[999_1_420px] flex-col overflow-hidden rounded-[var(--radius-xl)] border md:flex"
    >
      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--line-soft)] px-6 py-6">
        <span
          className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full text-lg font-semibold"
          aria-hidden="true"
        >
          {contactInitials(contact.name)}
        </span>
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <span className="text-xl leading-[26px] font-semibold">{contact.name}</span>
          <span className="text-ink-muted">
            {role} · {sub}
          </span>
        </div>
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

      <div className="grid grid-cols-3 border-b border-[var(--line-soft)]">
        <div className="flex flex-col gap-1 border-r border-[var(--line-soft)] px-6 py-4">
          <span className="text-ink-muted text-[13px]">{volLabel}</span>
          <span className="text-xl font-semibold tabular-nums">
            €&nbsp;
            <Money amount={volume} />
          </span>
        </div>
        <div className="flex flex-col gap-1 border-r border-[var(--line-soft)] px-6 py-4">
          <span className="text-ink-muted text-[13px]">{t('contacts.card.documents')}</span>
          <span className="text-xl font-semibold tabular-nums">{docLabel}</span>
        </div>
        <div className="flex flex-col gap-1 px-6 py-4">
          <span className="text-ink-muted text-[13px]">{t('contacts.card.stillOpen')}</span>
          <span
            className={cn(
              'text-xl font-semibold tabular-nums',
              openMinor > 0n && 'text-destructive',
            )}
          >
            €&nbsp;
            <Money amount={openMinor} />
          </span>
        </div>
      </div>

      {contact.isCustomer && salesDocs.length > 0 && (
        <>
          <h2 className="text-ink-muted px-6 pt-4 pb-2 text-xs font-semibold tracking-[0.04em] uppercase">
            {t('contacts.card.invoicesHeading')}
          </h2>
          {salesDocs.slice(0, 8).map((doc) => {
            const status = salesDocStatus(doc, openByInvoiceId)
            return (
              <Link
                key={doc.id}
                to="/invoices/$invoiceId"
                params={{ invoiceId: doc.id }}
                className="hover:bg-[var(--surface-hover)] flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-6 py-2.5 text-sm no-underline"
              >
                <span className="flex-1 tabular-nums">
                  {doc.number ?? t('contacts.card.draft')}
                </span>
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
          })}
        </>
      )}

      {contact.isSupplier && !contact.isCustomer && (
        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <span className="text-ink-2 text-sm">{supplierOpenLine}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/purchases" search={{ open: true }}>
              {t('contacts.card.openCosts')}
            </Link>
          </Button>
        </div>
      )}

      {contact.isSupplier && contact.isCustomer && purchaseDocs.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-6 py-4">
          <span className="text-ink-2 text-sm">{supplierOpenLine}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/purchases" search={{ open: true }}>
              {t('contacts.card.openCosts')}
            </Link>
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-[150px_1fr] gap-y-2.5 border-t border-[var(--line-soft)] px-6 py-4 text-sm">
        <dt className="text-ink-muted">{t('contacts.card.number')}</dt>
        <dd className="m-0 tabular-nums">{contact.number}</dd>
        <dt className="text-ink-muted">{t('contacts.vatNumber')}</dt>
        <dd className="m-0 tabular-nums">
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

      {detail !== null && detail.ok && detail.canErase && (
        <PrivacyErase contactId={contact.id} openCount={openCount} onErased={onErased} />
      )}

      {detail !== null && !detail.ok && (
        <p role="alert" className="text-destructive px-6 pb-4 text-sm">
          {detail.detail}
        </p>
      )}
    </aside>
  )
}

function PrivacyErase({
  contactId,
  openCount,
  onErased,
}: {
  contactId: string
  openCount: number
  onErased: () => void
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
