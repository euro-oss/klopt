import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { discardInboxItem, draftFromInbox, listInbox, receiveDocument } from '~/server/inbox'
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
    contacts: await listContacts({ data: { customersOnly: false } }),
    accounts: await listAccounts(),
    taxCodes: await listTaxCodes(),
  }),
  component: Inbox,
})

const SOURCE_LABEL: Record<string, string> = {
  upload: 'geüpload',
  email: 'per e-mail',
  peppol: 'via Peppol',
  generated: 'zelf gemaakt',
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

  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const key = useRef<string>(crypto.randomUUID())

  if (!inbox.ok) {
    return (
      <>
        <PageHeader title="Postvak" />
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
          ? result.problem.violations.map((item) => item.message)
          : [result.problem.detail],
      )
      return
    }

    if (result.data.alreadyHeld) {
      setNote('Dit bestand was er al. Het staat nu twee keer in het postvak, als één document.')
    } else if (result.data.parseError !== null) {
      setNote(`Er kon niets uit gelezen worden: ${result.data.parseError}`)
    } else if (result.data.parsed === null) {
      setNote(
        'Opgeslagen. Uit dit soort bestand kan niets gelezen worden — voer de factuur zelf in en hang dit bestand eraan.',
      )
    } else if (result.data.matchedSupplier === null) {
      setNote('Gelezen, maar niet aan een leverancier gekoppeld. Kies er zelf een.')
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
          ? result.problem.violations.map((entry) => entry.message)
          : [result.problem.detail],
      )
      return
    }

    setOpen(null)
    await navigate({ to: '/purchases/$invoiceId', params: { invoiceId: result.data.id } })
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
        title="Postvak"
        description="Alles wat binnenkomt — geüpload, per e-mail, via Peppol — staat in één rij. Wat gelezen kan worden is al ingevuld; de rest wacht op iemand."
        actions={
          <label className="bg-primary text-primary-foreground cursor-pointer rounded-md px-4 py-2 text-sm font-medium">
            {busy ? 'Bezig…' : 'Bestand toevoegen'}
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
          label="Wacht op behandeling"
          value={String(inbox.data.waiting)}
          tone={inbox.data.waiting > 0 ? 'warn' : 'neutral'}
        />
        <Stat label="In beeld" value={String(items.length)} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(
          [
            ['Nieuw', undefined],
            ['Verwerkt', 'drafted'],
            ['Terzijde gelegd', 'discarded'],
          ] as const
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
                ? 'bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm'
                : 'border-input rounded-md border px-3 py-1.5 text-sm disabled:opacity-50'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {note !== null && (
        <p className="border-border mb-4 max-w-2xl rounded-md border border-dashed p-3 text-sm">
          {note}
        </p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-4 max-w-2xl space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <p className="text-muted-foreground border-border max-w-2xl rounded-md border border-dashed p-4 text-sm">
          Niets in het postvak.
        </p>
      )}

      <ul className="max-w-4xl space-y-3">
        {items.map((item) => {
          const parsed = item.parsed
          const expanded = open === item.id

          return (
            <li key={item.id} className="border-border rounded-md border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {parsed === null
                      ? (item.filename ?? 'Document zonder naam')
                      : `${parsed.invoice.supplierInvoiceNumber} · ${parsed.supplier.name ?? 'onbekende afzender'}`}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {SOURCE_LABEL[item.source] ?? item.source} op{' '}
                    {formatDate(item.receivedAt.slice(0, 10))} · {item.contentType} ·{' '}
                    {formatBytes(item.sizeBytes)}
                    {item.receivedFrom !== null && ` · van ${item.receivedFrom}`}
                    {item.seenBefore && (
                      <span className="text-unreconciled"> · dit bestand was er al</span>
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
                    Document openen
                  </a>
                  {item.state === 'new' && (
                    <button
                      type="button"
                      disabled={!hydrated || busy}
                      onClick={() => {
                        setOpen(expanded ? null : item.id)
                      }}
                      className="border-input rounded-md border px-3 py-1.5 disabled:opacity-50"
                    >
                      {expanded ? 'Sluiten' : 'Verwerken'}
                    </button>
                  )}
                  {item.purchaseInvoiceId !== null && (
                    <Link
                      to="/purchases/$invoiceId"
                      params={{ invoiceId: item.purchaseInvoiceId }}
                      className="underline"
                    >
                      Naar de factuur
                    </Link>
                  )}
                </div>
              </div>

              {item.parseError !== null && (
                <p className="text-muted-foreground mt-2 text-sm">
                  Er kon niets uit gelezen worden: {item.parseError}
                </p>
              )}
              {item.discardedReason !== null && (
                <p className="text-muted-foreground mt-2 text-sm">
                  Terzijde gelegd: {item.discardedReason}
                </p>
              )}

              {parsed !== null && (
                <p className="mt-2 text-sm">
                  <Money amount={parsed.invoice.total} /> · {formatDate(parsed.invoice.invoiceDate)}{' '}
                  · vervalt {formatDate(parsed.invoice.dueDate)}
                  {item.contactName !== null && ` · ${item.contactName}`}
                  {item.contactName === null && (
                    <span className="text-unreconciled"> · nog geen leverancier</span>
                  )}
                </p>
              )}

              {parsed !== null && parsed.findings.length > 0 && (
                <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                  {parsed.findings.map((finding, index) => (
                    <li key={`${finding.code}-${String(index)}`}>{finding.message}</li>
                  ))}
                </ul>
              )}

              {expanded && (
                <div className="border-border mt-4 border-t pt-4">
                  {parsed === null ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void discard(item.id, field(new FormData(event.currentTarget), 'reason'))
                      }}
                      className="max-w-xl space-y-3"
                    >
                      <p className="text-muted-foreground text-sm">
                        Uit dit bestand kan niets gelezen worden. Voer de factuur zelf in onder{' '}
                        <Link to="/purchases/new" className="underline">
                          Inkoopfacturen
                        </Link>
                        , of leg het terzijde.
                      </p>
                      <label className="block">
                        <span className="text-muted-foreground mb-1 block text-xs font-medium">
                          Waarom terzijde?
                        </span>
                        <input
                          name="reason"
                          required
                          aria-label="Waarom terzijde?"
                          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={!hydrated || busy}
                        className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Terzijde leggen
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
                      <label className="block max-w-sm">
                        <span className="text-muted-foreground mb-1 block text-xs font-medium">
                          Leverancier
                        </span>
                        <select
                          aria-label="Leverancier"
                          name="contactNumber"
                          defaultValue={item.contactNumber ?? ''}
                          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                        >
                          <option value="">— kies een leverancier —</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.number} value={supplier.number}>
                              {supplier.number} {supplier.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <table className="w-full text-sm">
                        <caption className="sr-only">
                          Regels uit het document, met de codering
                        </caption>
                        <thead>
                          <tr className="text-muted-foreground text-left text-xs">
                            <th scope="col">Omschrijving</th>
                            <th scope="col" className="w-48">
                              Grootboek
                            </th>
                            <th scope="col" className="w-40">
                              Btw-code
                            </th>
                            <th scope="col" className="w-24 text-right">
                              Excl. btw
                            </th>
                            <th scope="col" className="w-24 text-right">
                              Btw
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.invoice.lines.map((line, index) => (
                            <tr key={line.lineNumber}>
                              <td className="py-1 pr-2">{line.description}</td>
                              <td className="py-1 pr-2">
                                <select
                                  aria-label={`Grootboek regel ${String(index + 1)}`}
                                  name={`account-${String(index)}`}
                                  defaultValue={line.accountNumber}
                                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                                >
                                  {/* An explicit empty option, so a line the
                                      parse could not park anywhere shows as
                                      unchosen rather than silently taking the
                                      first cost account. */}
                                  <option value="">— kies —</option>
                                  {costAccounts.map((account) => (
                                    <option key={account.number} value={account.number}>
                                      {account.number} {account.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-1 pr-2">
                                <select
                                  aria-label={`Btw-code regel ${String(index + 1)}`}
                                  name={`tax-${String(index)}`}
                                  defaultValue={line.taxCode}
                                  className="border-input bg-background w-full rounded-md border px-2 py-1.5"
                                >
                                  <option value="">— kies —</option>
                                  {inputCodes.map((code) => (
                                    <option key={code.code} value={code.code}>
                                      {code.code} · {code.ratePercent}% · {code.description}
                                    </option>
                                  ))}
                                </select>
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
                          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          {busy ? 'Bezig…' : 'Concept maken'}
                        </button>
                        <button
                          type="button"
                          disabled={!hydrated || busy}
                          onClick={() => {
                            const reason = globalThis.prompt('Waarom terzijde?')
                            if (reason !== null && reason !== '') void discard(item.id, reason)
                          }}
                          className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                        >
                          Terzijde leggen
                        </button>
                        <span className="text-muted-foreground text-xs">
                          De bedragen komen van het document en zijn hier niet te wijzigen.
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
    </>
  )
}
