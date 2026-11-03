import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { ContactCard } from '~/components/contacts/contact-card'
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
  parseContactsRoleFilter,
  supplierOpenSummary,
  type ContactListRow,
  type ContactsRoleFilter,
  type ContactSalesDoc,
} from '~/lib/contacts-list'
import { useHydrated } from '~/lib/hydration'
import { isTypingInto } from '~/lib/keyboard'
import { localTodayIso } from '~/lib/local-clock'
import { cn } from '~/lib/utils'
import { listPurchaseInvoices } from '~/server/purchase'
import { createContact, listContacts, listInvoices, listOverdueInvoices } from '~/server/sales'

/**
 * Contacts — list + card (#107 Phase 6 / #130).
 *
 * Board: `Contacts` at `fa4093b` (desktop light). Phone list and card follow
 * `PhoneContacts` / `PhoneContactCard` (+ dark derived boards). Dark desktop
 * uses tokens with `--ink-muted` control borders.
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
  const { t, plural } = useT()
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
      <header className="mb-0 flex flex-col gap-3 pt-1 md:flex-row md:flex-wrap md:items-center md:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="min-w-0 flex-1 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
            {t('contacts.title')}
          </h1>
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
            className="min-h-11 shrink-0 md:hidden"
          >
            {creating ? t('common.cancel') : t('contacts.newShort')}
          </Button>
        </div>
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
          className="hidden min-h-11 md:inline-flex md:min-h-10"
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
                  const lateDays = stats?.lateDays ?? null
                  const isActive = row.id === activeId
                  const sub = row.email !== null && row.email !== '' ? row.email : row.number
                  const role = contactRoleLabel(row, roleLabels)
                  const rowPurchases = purchaseDocs.filter(
                    (doc) => doc.contactNumber === row.number,
                  )
                  const supplierStats =
                    row.isSupplier && !row.isCustomer
                      ? supplierOpenSummary(
                          rowPurchases.map((bill) => ({
                            id: bill.id,
                            contactNumber: bill.contactNumber,
                            total: bill.total,
                            outstanding: bill.outstanding,
                            dueDate: bill.dueDate,
                            status: bill.status,
                          })),
                          asOf,
                        )
                      : null
                  const openLabel =
                    openMinor > 0n ? (
                      <>
                        €&nbsp;
                        <Money amount={openMinor} />
                      </>
                    ) : (
                      <span className="text-ink-muted text-[13px] font-normal md:text-sm">
                        {t('contacts.list.openNone')}
                      </span>
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
                      <span className="flex min-w-0 flex-1 flex-col gap-1 md:gap-0.5">
                        <span className="flex items-baseline justify-between gap-3 md:block">
                          <span
                            data-contact-name=""
                            title={row.name}
                            className={cn(
                              'break-words font-medium md:block',
                              row.isBlocked && 'text-muted-foreground line-through',
                            )}
                          >
                            {row.name}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 tabular-nums md:hidden',
                              openMinor > 0n ? 'text-destructive text-[15px] font-semibold' : '',
                            )}
                          >
                            {openLabel}
                          </span>
                        </span>
                        <span
                          className="text-ink-muted hidden truncate text-xs md:block"
                          title={sub}
                        >
                          {sub}
                        </span>
                        <span className="text-ink-2 flex items-center justify-between gap-3 text-[13px] md:hidden">
                          <span className="min-w-0 truncate" title={`${role} · ${sub}`}>
                            {role} · {sub}
                          </span>
                          {row.isCustomer && lateDays !== null && lateDays > 0 ? (
                            <Badge variant="destructive" className="shrink-0">
                              {plural('sales.pill.daysLate', lateDays, {
                                days: String(lateDays),
                              })}
                            </Badge>
                          ) : supplierStats !== null && supplierStats.overdueCount > 0 ? (
                            <Badge variant="destructive" className="shrink-0">
                              {t('contacts.list.pastDue')}
                            </Badge>
                          ) : null}
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
                        {openMinor > 0n ? (
                          <>
                            €&nbsp;
                            <Money amount={openMinor} />
                          </>
                        ) : (
                          '–'
                        )}
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
