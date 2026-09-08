import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import { listAuditLog } from '~/server/ledger'

/**
 * Wie wat heeft gedaan (spec 7.6).
 *
 * The screen exists so the log is looked at before somebody has to hand it
 * over. An audit trail nobody reads until an inspection is an audit trail
 * nobody has checked — and the first time you read it should not be the day it
 * matters.
 *
 * The download is a plain link rather than a button: it is a file, and
 * `/api/v1/audit-log/export` streams it, so a year does not have to be built in
 * memory before the browser sees a byte.
 */
export const Route = createFileRoute('/_app/audit-log')({
  validateSearch: (search: Record<string, unknown>): { resourceType?: string } =>
    typeof search['resourceType'] === 'string' && search['resourceType'] !== ''
      ? { resourceType: search['resourceType'] }
      : {},
  loaderDeps: ({ search }) => ({ resourceType: search.resourceType }),
  loader: async ({ deps }) => ({
    resourceType: deps.resourceType,
    log: await listAuditLog({
      data: {
        limit: 200,
        ...(deps.resourceType === undefined ? {} : { resourceType: deps.resourceType }),
      },
    }),
  }),
  component: AuditLog,
})

/** The resource kinds worth a filter chip. Everything else is reachable by API. */
const KINDS = [
  ['Alles', undefined],
  ['Journaalposten', 'journal_entry'],
  ['Verkoopfacturen', 'sales_invoice'],
  ['Inkoopfacturen', 'purchase_invoice'],
  ['Betaalbatches', 'payment_batch'],
  ['BTW-aangiften', 'vat_filing'],
  ['Relaties', 'contact'],
  ['Bank', 'bank_transaction'],
  ['Instellingen', 'entity'],
] as const

const ACTOR_LABEL: Record<string, string> = {
  human: 'mens',
  script: 'script',
  agent: 'agent',
}

function AuditLog() {
  const { log, resourceType } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const [open, setOpen] = useState<string | null>(null)

  if (!log.ok) {
    return (
      <>
        <PageHeader title="Wie wat deed" />
        <p role="alert" className="text-destructive text-sm">
          {log.problem.detail}
        </p>
      </>
    )
  }

  const entries = log.data.entries

  return (
    <>
      <PageHeader
        title="Wie wat deed"
        description="Elke wijziging met wie, wanneer, vanaf welk adres en onder welk verzoek. Alleen toevoegen — een correctie is een nieuwe regel, net als in het journaal."
        actions={
          <a
            href="/api/v1/audit-log/export?format=csv"
            className="border-border rounded-md border px-4 py-2 text-sm"
          >
            Exporteren
          </a>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label="Regels in beeld" value={String(entries.length)} />
        <Stat
          label="Mensen"
          value={String(
            new Set(entries.filter((entry) => entry.actor.kind === 'human').map((e) => e.actor.id))
              .size,
          )}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {KINDS.map(([label, value]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              void navigate({ search: value === undefined ? {} : { resourceType: value } })
            }}
            className={
              resourceType === value
                ? 'bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium'
                : 'border-border rounded-md border px-3 py-1.5 text-sm'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          Nog niets vastgelegd.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-md border">
          {entries.map((entry) => (
            <li key={entry.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tabular text-muted-foreground text-xs">
                  {formatDate(entry.occurredAt.slice(0, 10))} {entry.occurredAt.slice(11, 19)}
                </span>
                <span className="font-medium">{entry.action}</span>
                <span className="text-muted-foreground text-xs">
                  {entry.resourceType} · {entry.actor.id} ({ACTOR_LABEL[entry.actor.kind]}
                  {/* Spec 10.3: an agent action names the human behind its token. */}
                  {entry.actor.principalId !== null && ` voor ${entry.actor.principalId}`})
                </span>
                {(entry.before !== null || entry.after !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen((current) => (current === entry.id ? null : entry.id))
                    }}
                    className="text-primary ml-auto text-xs underline"
                  >
                    {open === entry.id ? 'Verbergen' : 'Wat er veranderde'}
                  </button>
                )}
              </div>

              {open === entry.id && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">Voor</p>
                    <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs">
                      {JSON.stringify(entry.before, null, 2) ?? '—'}
                    </pre>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">Na</p>
                    <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs">
                      {JSON.stringify(entry.after, null, 2) ?? '—'}
                    </pre>
                  </div>
                  <p className="text-muted-foreground sm:col-span-2 text-xs">
                    {entry.resourceId}
                    {entry.requestId !== null && ` · verzoek ${entry.requestId}`}
                    {entry.ip !== null && ` · ${entry.ip}`}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
