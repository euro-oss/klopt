import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { findingMessage, violationMessage } from '~/i18n/labels'
import { useEffect, useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { AccountPicker } from '~/components/finance/account-picker'
import { ShortcutStrip } from '~/components/ui/keycap'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { resolveListKey } from '~/lib/list-cursor'
import { cn } from '~/lib/utils'
import {
  addInboundSource,
  discardInboxItem,
  draftFromInbox,
  listInbox,
  listInboundSources,
  pollInboundSource,
  receiveDocument,
  removeInboundSource,
} from '~/server/inbox'
import { listContacts, listTaxCodes } from '~/server/sales'
import { listAccounts } from '~/server/ledger'

/**
 * Postvak — everything that has arrived and not been dealt with.
 *
 * One queue whatever the source, because the work is the same work: look at the
 * document, decide whether it is an invoice for us, and if it is, say what the
 * cost is for. A UBL arrival has most of that filled in already; a PDF has none
 * of it and still belongs in the same list, because a queue you have to check
 * in two places is a queue that gets checked in one.
 *
 * The amounts are never editable here. They are the document's, and a screen
 * that let somebody adjust them on the way in would be a screen for making the
 * books disagree with the paper.
 */
export const Route = createFileRoute('/_app/inbox')({
  validateSearch: (search: Record<string, unknown>): { state?: string } =>
    search['state'] === 'drafted' || search['state'] === 'discarded'
      ? { state: search['state'] }
      : {},
  loaderDeps: ({ search }) => ({ state: search.state }),
  loader: async ({ deps }) => ({
    state: deps.state,
    inbox: await listInbox({
      data: deps.state === undefined ? { state: 'new' as const } : {},
    }),
    sources: await listInboundSources(),
    contacts: await listContacts({ data: { customersOnly: false } }),
    accounts: await listAccounts(),
    taxCodes: await listTaxCodes(),
  }),
  component: Inbox,
})

const SOURCE_KEY: Record<string, MessageKey> = {
  upload: 'inbox.source.upload',
  email: 'inbox.source.email',
  peppol: 'inbox.source.peppol',
  generated: 'inbox.source.generated',
}

function formatBytes(size: number): string {
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} kB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function Inbox() {
  const { inbox, contacts, accounts, taxCodes, state } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised source is shown raw rather than as a blank. */
  const sourceOf = (source: string) => {
    const key = SOURCE_KEY[source]
    return key === undefined ? source : t(key)
  }

  const [open, setOpen] = useState<string | null>(null)
  /** The item whose "why set aside" panel is open, if any. */
  const [aside, setAside] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const key = useRef<string>(crypto.randomUUID())

  /**
   * The cursor, and the cards it moves through.
   *
   * The postvak is the third list in this application worked from the keyboard,
   * and it uses the same four keys as the koppelscherm and the werklijst plus
   * the two that are its own work: `a` makes the draft and `s` sets the document
   * aside. Without this the screen was a column of cards and a Tab key, which is
   * the one place the invoice → koppelen → postvak spine went missing.
   */
  const [cursor, setCursor] = useState(0)
  const cards = useRef<(HTMLLIElement | null)[]>([])
  const panels = useRef<Map<string, HTMLDivElement | null>>(new Map())

  /**
   * Put the focus where the work is.
   *
   * Opening a document lands on the first field of its panel rather than leaving
   * the focus on the card: the next thing somebody does is check the coding, and
   * `Tab` from a card would walk them past it.
   */
  useEffect(() => {
    if (open === null) return
    const panel = panels.current.get(open)
    panel?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus()
  }, [open])

  if (!inbox.ok) {
    return (
      <>
        <PageHeader title={t('inbox.title')} />
        <p role="alert" className="text-destructive text-sm">
          {inbox.problem.detail}
        </p>
      </>
    )
  }

  const items = inbox.data.items
  const suppliers = contacts.ok
    ? contacts.data.contacts.filter((contact) => contact.isSupplier && !contact.isBlocked)
    : []
  const costAccounts = accounts.ok
    ? accounts.data.accounts.filter(
        (account) => account.type === 'expense' || account.type === 'asset',
      )
    : []
  const inputCodes = taxCodes.ok
    ? taxCodes.data.taxCodes.filter((code) => code.direction === 'input')
    : []

  async function upload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (file === undefined) return

    setBusy(true)
    setProblems([])
    setNote(null)

    const base64 = btoa(
      // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on
      // anything bigger than about a hundred kilobytes, which every scanned
      // invoice is.
      Array.from(new Uint8Array(await file.arrayBuffer()), (byte) =>
        String.fromCharCode(byte),
      ).join(''),
    )

    const result = await receiveDocument({
      data: {
        idempotencyKey: key.current,
        filename: file.name,
        contentType: file.type,
        base64,
      },
    })
    setBusy(false)
    key.current = crypto.randomUUID()
    event.target.value = ''

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item))
          : [result.problem.detail],
      )
      return
    }

    if (result.data.alreadyHeld) {
      setNote(t('inbox.alreadyHeld'))
    } else if (result.data.parseError !== null) {
      setNote(t('inbox.parseError', { reason: result.data.parseError }))
    } else if (result.data.parsed === null) {
      setNote(t('inbox.unreadable'))
    } else if (result.data.matchedSupplier === null) {
      setNote(t('inbox.noSupplierMatched'))
    }

    await router.invalidate()
  }

  /** A form field's value. `FormData.get` returns `File | string | null`. */
  function field(form: FormData, name: string): string {
    const value = form.get(name)
    return typeof value === 'string' ? value : ''
  }

  async function draft(itemId: string, form: FormData): Promise<void> {
    setBusy(true)
    setProblems([])

    const item = items.find((entry) => entry.id === itemId)
    const lineCount = item?.parsed?.invoice.lines.length ?? 0
    const contactNumber = form.get('contactNumber')

    const result = await draftFromInbox({
      data: {
        itemId,
        idempotencyKey: key.current,
        body: {
          contactNumber:
            typeof contactNumber === 'string' && contactNumber !== '' ? contactNumber : null,
          lines: Array.from({ length: lineCount }, (_, index) => ({
            accountNumber: field(form, `account-${String(index)}`),
            taxCode: field(form, `tax-${String(index)}`),
          })),
        },
      },
    })
    setBusy(false)
    key.current = crypto.randomUUID()

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((entry) => violationMessage(t, entry))
          : [result.problem.detail],
      )
      return
    }

    setOpen(null)
    await navigate({ to: '/purchases/$invoiceId', params: { invoiceId: result.data.id } })
  }

  function focusCard(index: number): void {
    setCursor(index)
    cards.current[index]?.focus()
  }

  /** The primary action: make a draft of what the cursor is on. */
  function approve(itemId: string): void {
    const item = items.find((entry) => entry.id === itemId)
    if (item === undefined || item.state !== 'new') return

    if (item.parsed === null) {
      // Nothing was read out of it, so there is nothing to book. Said out loud,
      // because a key that silently does nothing reads as a broken key.
      setNote(t('inbox.nothingToDraft'))
      setOpen(itemId)
      return
    }

    // Opened first, booked second: the coding is what is being approved, so the
    // first `a` shows it and the second submits the panel that shows it.
    if (open !== itemId) {
      setOpen(itemId)
      return
    }

    panels.current.get(itemId)?.querySelector('form')?.requestSubmit()
  }

  async function discard(itemId: string, reason: string): Promise<void> {
    setBusy(true)
    setProblems([])
    const result = await discardInboxItem({
      data: { itemId, idempotencyKey: key.current, body: { reason } },
    })
    setBusy(false)
    key.current = crypto.randomUUID()

    if (!result.ok) {
      setProblems([result.problem.detail])
      return
    }
    setOpen(null)
    await router.invalidate()
  }

  return (
    <>
      <PageHeader
        title={t('inbox.title')}
        description={t('inbox.intro')}
        actions={
          <label className="bg-primary text-primary-foreground cursor-pointer px-4 py-2 text-sm font-medium">
            {busy ? t('common.busy') : t('inbox.addFile')}
            <input
              type="file"
              className="sr-only"
              disabled={!hydrated || busy}
              onChange={(event) => {
                void upload(event)
              }}
            />
          </label>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat
          label={t('inbox.waiting')}
          value={String(inbox.data.waiting)}
          tone={inbox.data.waiting > 0 ? 'warn' : 'neutral'}
        />
        <Stat label={t('inbox.showing')} value={String(items.length)} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ['inbox.filter.new', undefined],
            ['inbox.filter.drafted', 'drafted'],
            ['inbox.filter.discarded', 'discarded'],
          ] as const satisfies readonly (readonly [MessageKey, string | undefined])[]
        ).map(([label, value]) => (
          <button
            key={label}
            type="button"
            disabled={!hydrated}
            onClick={() => {
              void navigate({
                to: '/inbox',
                search: value === undefined ? {} : { state: value },
              })
            }}
            className={
              state === value
                ? 'bg-primary text-primary-foreground px-3 py-1.5 text-sm'
                : 'border-input border px-3 py-1.5 text-sm disabled:opacity-50'
            }
          >
            {t(label)}
          </button>
        ))}
      </div>

      {note !== null && (
        <p className="border-border mb-4 max-w-2xl border border-dashed p-3 text-sm">{note}</p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-4 max-w-2xl space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <p className="text-muted-foreground border-border max-w-2xl border border-dashed p-4 text-sm">
          {t('inbox.empty')}
        </p>
      )}

      <ul
        aria-label={t('inbox.queue')}
        className="max-w-4xl space-y-3"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return
          if (event.metaKey || event.ctrlKey || event.altKey) return

          const here = items[cursor]
          if (here === undefined) return

          // Escape is the one key that has to work from inside the panel: it is
          // how somebody gets back out of it. A picker with its own Escape stops
          // this one reaching the list, which is right — the field is the
          // innermost thing you are in.
          if (event.key === 'Escape') {
            event.preventDefault()
            if (aside !== null) {
              setAside(null)
              cards.current[cursor]?.focus()
              return
            }
            if (open !== null) {
              setOpen(null)
              cards.current[cursor]?.focus()
              return
            }
            cards.current[cursor]?.blur()
            return
          }

          // Every other key stands down for a field, a button or a link: the
          // panel below a card is a form, and `a` is a letter in every
          // supplier's name.
          const target = event.target as HTMLElement | null
          if (target !== null && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(target.tagName)) return

          if (event.key === 'a') {
            event.preventDefault()
            approve(here.id)
            return
          }
          if (event.key === 's') {
            event.preventDefault()
            if (here.state === 'new') setAside(here.id)
            return
          }

          const resolution = resolveListKey(event.key, { index: cursor, count: items.length })

          if (resolution.action === 'move') {
            event.preventDefault()
            focusCard(resolution.index)
            return
          }
          if (resolution.action === 'open') {
            event.preventDefault()
            if (here.state === 'new') setOpen(open === here.id ? null : here.id)
            return
          }
        }}
      >
        {items.map((item, index) => {
          const parsed = item.parsed
          const expanded = open === item.id

          return (
            <li
              key={item.id}
              ref={(element) => {
                cards.current[index] = element
              }}
              tabIndex={index === cursor ? 0 : -1}
              aria-current={index === cursor ? true : undefined}
              onFocus={() => {
                setCursor(index)
              }}
              className={cn(
                'border-border border p-4 outline-none',
                // The cursor is a yellow line round the card, the same mark the
                // tables and the pickers use for "the keyboard is here".
                index === cursor && 'border-primary outline-primary outline-2 -outline-offset-2',
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {parsed === null
                      ? (item.filename ?? t('inbox.unnamedDocument'))
                      : `${parsed.invoice.supplierInvoiceNumber} · ${parsed.supplier.name ?? t('inbox.unknownSender')}`}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {sourceOf(item.source)}
                    {t('inbox.receivedOn')}
                    {formatDate(item.receivedAt.slice(0, 10))} · {item.contentType} ·{' '}
                    {formatBytes(item.sizeBytes)}
                    {item.receivedFrom !== null &&
                      t('inbox.receivedFrom', { from: item.receivedFrom })}
                    {item.seenBefore && (
                      <span className="text-unreconciled">{t('inbox.seenBefore')}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <a
                    href={`/api/v1/documents/${item.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {t('inbox.openDocument')}
                  </a>
                  {item.state === 'new' && (
                    <button
                      type="button"
                      disabled={!hydrated || busy}
                      onClick={() => {
                        setOpen(expanded ? null : item.id)
                      }}
                      className="border-input border px-3 py-1.5 disabled:opacity-50"
                    >
                      {expanded ? t('inbox.close') : t('inbox.handle')}
                    </button>
                  )}
                  {item.purchaseInvoiceId !== null && (
                    <Link
                      to="/purchases/$invoiceId"
                      params={{ invoiceId: item.purchaseInvoiceId }}
                      className="underline"
                    >
                      {t('inbox.toInvoice')}
                    </Link>
                  )}
                </div>
              </div>

              {item.parseError !== null && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {t('inbox.parseError', { reason: item.parseError })}
                </p>
              )}
              {item.discardedReason !== null && (
                <p className="text-muted-foreground mt-2 text-sm">
                  {t('inbox.setAsideReason', { reason: item.discardedReason })}
                </p>
              )}

              {parsed !== null && (
                <p className="mt-2 text-sm">
                  <Money amount={parsed.invoice.total} /> · {formatDate(parsed.invoice.invoiceDate)}
                  {t('inbox.dueOn', { date: formatDate(parsed.invoice.dueDate) })}
                  {item.contactName !== null && ` · ${item.contactName}`}
                  {item.contactName === null && (
                    <span className="text-unreconciled">{t('inbox.noSupplierYet')}</span>
                  )}
                </p>
              )}

              {parsed !== null && parsed.findings.length > 0 && (
                <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                  {parsed.findings.map((finding, index) => (
                    <li key={`${finding.code}-${String(index)}`}>{findingMessage(t, finding)}</li>
                  ))}
                </ul>
              )}

              {aside === item.id && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const reason = field(new FormData(event.currentTarget), 'reason')
                    setAside(null)
                    if (reason !== '') void discard(item.id, reason)
                  }}
                  className="border-border mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
                >
                  {/* A field rather than `prompt()`, which is a dialogue the
                      screen does not control: it cannot be styled, it cannot be
                      escaped back to the card, and a blocking browser dialogue
                      in the middle of a keyboard flow is a stop rather than a
                      step. */}
                  <label className="block flex-1">
                    <span className="text-muted-foreground mb-1 block text-xs font-medium">
                      {t('inbox.whySetAside')}
                    </span>
                    <input
                      name="reason"
                      required
                      autoFocus
                      aria-label={t('inbox.whySetAside')}
                      className="border-input bg-background w-full border px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!hydrated || busy}
                    className="border-input border px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {t('inbox.setAside')}
                  </button>
                </form>
              )}

              {expanded && (
                <div
                  ref={(element) => {
                    panels.current.set(item.id, element)
                  }}
                  className="border-border mt-4 border-t pt-4"
                >
                  {parsed === null ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void discard(item.id, field(new FormData(event.currentTarget), 'reason'))
                      }}
                      className="max-w-xl space-y-3"
                    >
                      <p className="text-muted-foreground text-sm">
                        {t('inbox.cannotRead')}{' '}
                        <Link to="/purchases/new" className="underline">
                          {t('nav.purchases')}
                        </Link>
                        {t('inbox.orSetAside')}
                      </p>
                      <label className="block">
                        <span className="text-muted-foreground mb-1 block text-xs font-medium">
                          {t('inbox.whySetAside')}
                        </span>
                        <input
                          name="reason"
                          required
                          aria-label={t('inbox.whySetAside')}
                          className="border-input bg-background w-full border px-3 py-2 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={!hydrated || busy}
                        className="border-input border px-4 py-2 text-sm disabled:opacity-50"
                      >
                        {t('inbox.setAside')}
                      </button>
                    </form>
                  ) : (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void draft(item.id, new FormData(event.currentTarget))
                      }}
                      className="space-y-4"
                    >
                      <SelectField
                        label={t('contacts.supplierLabel')}
                        name="contactNumber"
                        defaultValue={item.contactNumber ?? ''}
                        disabled={!hydrated}
                        className="max-w-sm"
                      >
                        <SelectOption value="">{t('inbox.chooseSupplier')}</SelectOption>
                        {suppliers.map((supplier) => (
                          <SelectOption key={supplier.number} value={supplier.number}>
                            {supplier.number} {supplier.name}
                          </SelectOption>
                        ))}
                      </SelectField>

                      <table className="w-full text-sm">
                        <caption className="sr-only">{t('inbox.linesCaption')}</caption>
                        <thead>
                          <tr className="text-muted-foreground text-left text-xs">
                            <th scope="col">{t('entries.description')}</th>
                            <th scope="col" className="w-48">
                              {t('invoice.ledgerAccount')}
                            </th>
                            <th scope="col" className="w-40">
                              {t('purchaseNew.taxCode')}
                            </th>
                            <th scope="col" className="w-24 text-right">
                              {t('purchaseNew.excludingVat')}
                            </th>
                            <th scope="col" className="w-24 text-right">
                              {t('invoice.vat')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.invoice.lines.map((line, index) => (
                            <tr key={line.lineNumber}>
                              <td className="py-1 pr-2">{line.description}</td>
                              <td className="py-1 pr-2">
                                <AccountPicker
                                  label={t('invoiceNew.accountLine', {
                                    line: String(index + 1),
                                  })}
                                  labelHidden
                                  name={`account-${String(index)}`}
                                  accounts={costAccounts}
                                  defaultValue={line.accountNumber}
                                  disabled={!hydrated}
                                  // An explicit empty choice, so a line the
                                  // parse could not park anywhere shows as
                                  // unchosen rather than silently taking the
                                  // first cost account.
                                  emptyOption={t('inbox.choose')}
                                />
                              </td>
                              <td className="py-1 pr-2">
                                <SelectField
                                  label={t('purchaseNew.taxCodeLine', {
                                    line: String(index + 1),
                                  })}
                                  labelHidden
                                  name={`tax-${String(index)}`}
                                  defaultValue={line.taxCode}
                                  disabled={!hydrated}
                                >
                                  <SelectOption value="">{t('inbox.choose')}</SelectOption>
                                  {inputCodes.map((code) => (
                                    <SelectOption key={code.code} value={code.code}>
                                      {code.code} · {code.ratePercent}% · {code.description}
                                    </SelectOption>
                                  ))}
                                </SelectField>
                              </td>
                              {/* The amounts are the document's. Not editable
                                  here: this screen captures what arrived. */}
                              <td className="tabular py-1 text-right">
                                <Money amount={line.net} />
                              </td>
                              <td className="tabular py-1 text-right">
                                <Money amount={line.tax} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          disabled={!hydrated || busy}
                          className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          {busy ? t('common.busy') : t('inbox.makeDraft')}
                        </button>
                        <button
                          type="button"
                          disabled={!hydrated || busy}
                          onClick={() => {
                            setAside(item.id)
                          }}
                          className="border-input border px-4 py-2 text-sm disabled:opacity-50"
                        >
                          {t('inbox.setAside')}
                        </button>
                        <span className="text-muted-foreground text-xs">
                          {t('inbox.amountsFixed')}
                        </span>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {items.length > 0 && (
        <ShortcutStrip
          floating
          ids={[
            'inbox.next',
            'inbox.previous',
            'inbox.open',
            'inbox.approve',
            'inbox.skip',
            'inbox.leave',
          ]}
        />
      )}

      <InboundSources />
    </>
  )
}

const KIND_KEY: Record<string, MessageKey> = {
  maildir: 'sources.label.maildir',
  imap: 'sources.label.imap',
  peppol: 'sources.label.peppol',
}

/**
 * Where post comes from.
 *
 * On this screen rather than in Instellingen because it answers the question
 * this screen raises: the queue is empty, is that because nothing arrived or
 * because the mailbox has been refusing a password since Tuesday? A poller
 * whose failures are only in a log is a poller nobody knows has stopped.
 */
function InboundSources() {
  const { sources } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised kind is shown raw rather than as a blank. */
  const kindOf = (kind: string) => {
    const key = KIND_KEY[kind]
    return key === undefined ? kind : t(key)
  }

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'maildir' | 'imap'>('maildir')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())

  if (!sources.ok) return null
  const rows = sources.data.sources

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)
    const result = await addInboundSource({
      data: {
        idempotencyKey: key.current,
        kind,
        name: text('name'),
        ...(kind === 'maildir'
          ? { directory: text('directory') }
          : {
              host: text('host'),
              user: text('user'),
              password: text('password'),
              mailbox: text('mailbox') === '' ? 'INBOX' : text('mailbox'),
              processedMailbox: text('processedMailbox') === '' ? null : text('processedMailbox'),
            }),
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    key.current = crypto.randomUUID()
    setOpen(false)
    await router.invalidate()
  }

  async function poll(sourceId: string) {
    setBusy(true)
    setNote(null)
    setError(null)
    const result = await pollInboundSource({ data: { sourceId } })
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    setNote(
      result.data.ok
        ? t('sources.pollResult', {
            messages: String(result.data.filed),
            documents: String(result.data.documents),
          })
        : (result.data.failure ?? t('sources.pollFailed')),
    )
    await router.invalidate()
  }

  async function remove(sourceId: string) {
    setBusy(true)
    await removeInboundSource({ data: { sourceId } })
    setBusy(false)
    await router.invalidate()
  }

  return (
    <section className="border-border mt-10 max-w-3xl border p-4">
      <h2 className="mb-1 text-sm font-semibold">{t('sources.title')}</h2>
      <p className="text-muted-foreground mb-3 text-sm">{t('sources.intro')}</p>

      {!sources.data.canStoreSecrets && (
        <p className="text-muted-foreground mb-3 text-xs">{t('sources.noSecrets')}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground mb-3 text-sm">{t('sources.empty')}</p>
      ) : (
        <table className="mb-3 w-full text-sm">
          <caption className="sr-only">{t('sources.caption')}</caption>
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th scope="col">{t('sources.name')}</th>
              <th scope="col">{t('sources.where')}</th>
              <th scope="col">{t('sources.lastPolled')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-border/50 border-t align-top">
                <td className="py-1.5 pr-2">
                  {row.name}
                  <span className="text-muted-foreground text-xs"> {kindOf(row.kind)}</span>
                </td>
                <td className="text-muted-foreground py-1.5 pr-2 text-xs">{row.where}</td>
                <td className="py-1.5 pr-2 text-xs">
                  {row.lastPolledAt === null ? (
                    <span className="text-muted-foreground">{t('sources.never')}</span>
                  ) : (
                    <span className="tabular">{formatDate(row.lastPolledAt.slice(0, 10))}</span>
                  )}
                  {row.lastError !== null && (
                    <span className="text-destructive block">{row.lastError}</span>
                  )}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {row.kind !== 'peppol' && (
                    <button
                      type="button"
                      disabled={!hydrated || busy}
                      onClick={() => {
                        void poll(row.id)
                      }}
                      className="text-primary mr-3 text-xs underline disabled:opacity-50"
                    >
                      {t('sources.pollNow')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!hydrated || busy}
                    onClick={() => {
                      void remove(row.id)
                    }}
                    className="text-muted-foreground text-xs underline disabled:opacity-50"
                  >
                    {t('sources.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {note !== null && <p className="mb-3 text-sm">{note}</p>}
      {error !== null && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!hydrated}
        onClick={() => {
          setOpen(!open)
        }}
        className="border-border border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {open ? t('common.cancel') : t('sources.add')}
      </button>

      {open && (
        <form
          className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            void add(event)
          }}
        >
          <SelectField
            label={t('sources.kind')}
            value={kind}
            disabled={!hydrated}
            onValueChange={(next) => {
              setKind(next === 'imap' ? 'imap' : 'maildir')
            }}
          >
            <SelectOption value="maildir">{t('sources.kindMaildir')}</SelectOption>
            <SelectOption value="imap">{t('sources.kindImap')}</SelectOption>
          </SelectField>

          <div>
            <label
              htmlFor="source-name"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              {t('sources.name')}
            </label>
            <input
              id="source-name"
              name="name"
              required
              className="border-input bg-background w-full border px-3 py-2 text-sm"
            />
          </div>

          {kind === 'maildir' ? (
            <div className="sm:col-span-2">
              <label
                htmlFor="source-directory"
                className="text-muted-foreground mb-1 block text-xs font-medium"
              >
                {t('sources.directory')}
              </label>
              <input
                id="source-directory"
                name="directory"
                required
                placeholder="/var/klopt/postvak"
                className="border-input bg-background w-full border px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="source-host"
                  className="text-muted-foreground mb-1 block text-xs font-medium"
                >
                  {t('sources.host')}
                </label>
                <input
                  id="source-host"
                  name="host"
                  required
                  placeholder="imap.example.nl"
                  className="border-input bg-background w-full border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="source-user"
                  className="text-muted-foreground mb-1 block text-xs font-medium"
                >
                  {t('sources.user')}
                </label>
                <input
                  id="source-user"
                  name="user"
                  required
                  className="border-input bg-background w-full border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="source-password"
                  className="text-muted-foreground mb-1 block text-xs font-medium"
                >
                  {t('sources.password')}
                </label>
                <input
                  id="source-password"
                  name="password"
                  type="password"
                  required
                  className="border-input bg-background w-full border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="source-processed"
                  className="text-muted-foreground mb-1 block text-xs font-medium"
                >
                  {t('sources.processedMailbox')}
                </label>
                <input
                  id="source-processed"
                  name="processedMailbox"
                  placeholder={t('sources.processedPlaceholder')}
                  className="border-input bg-background w-full border px-3 py-2 text-sm"
                />
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={!hydrated || busy}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('common.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
