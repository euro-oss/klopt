import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { violationMessage } from '~/i18n/labels'
import { useT } from '~/i18n/provider'
import { currentFiscalYear, type FiscalYearOption } from '~/lib/fiscal-year'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { importAuditFile } from '~/server/ledger'
import { listFiscalYears } from '~/server/setup'

/**
 * Auditfile — out and back in.
 *
 * Klopt has exported XAF 3.2 since M2 and could not read one back, which makes
 * "your books are yours" a one-way claim: an auditfile is the format a Dutch
 * bookkeeper moves a year in, and half a converter is a lock-in.
 *
 * Export and import share this screen because they are the same door. The
 * dashboard keeps its download link and points here as well.
 *
 * ## The chart has to match
 *
 * There is no chart-of-accounts *create* operation in the API, and Product
 * settled the question this issue asked before any of this was built: option
 * (b), the file must already match the chart. Expanding the chart from a file —
 * accounts, dagboeken and btw-codes — is a domain change with its own review
 * and is #15, not this screen.
 *
 * So the dry run's job is to say that plainly, *before* anything is posted, and
 * name the count. The commit button is not offered for a file the chart cannot
 * take: the alternative is a button that exists to fail, and the failure it
 * produces is a list of account numbers halfway through a form.
 *
 * ## Two steps, and the second one cannot be reached first
 *
 * Same shape as the bank import, for the same reason: what a file would do is
 * worth seeing before it happens rather than after. `POST /imports/audit-file`
 * defaults to `dryRun: true` and the commit passes `false` explicitly, so the
 * dangerous call is the one that had to be spelled out.
 */
export const Route = createFileRoute('/_app/audit-file')({
  loader: async () => ({ years: await listFiscalYears() }),
  component: AuditFile,
})

/**
 * What the import reports, dry run or not — one shape, deliberately (ADR 0048:
 * an import report a script can read), and read off the operation rather than
 * described again here.
 *
 * Writing the fields out would be a second copy of the response schema to keep
 * in step, and the first thing to drift would be a field this screen does not
 * render.
 */
type ImportReport = Extract<Awaited<ReturnType<typeof importAuditFile>>, { ok: true }>['data']

function AuditFile() {
  const { years } = Route.useLoaderData()
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  const options: readonly FiscalYearOption[] = years.ok ? years.data.fiscalYears : []
  const today = new Date().toISOString().slice(0, 10)

  const [exportYear, setExportYear] = useState(
    () => currentFiscalYear(options, today)?.code ?? options[0]?.code ?? '',
  )

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<readonly string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ xml: string; report: ImportReport } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  /** One key per attempt: a confirm clicked twice imports the file once. */
  const importKey = useRef(crypto.randomUUID())

  /**
   * Whether the chart can take the file as it stands.
   *
   * Counts rather than names, because the dry run reports counts — enriching it
   * with the names is #15, and a screen that invents them would be guessing.
   */
  const chartMatches =
    preview !== null && preview.report.accounts.new === 0 && preview.report.journals.new === 0

  function clear(): void {
    setPreview(null)
    setProblems(null)
    setNotice(null)
  }

  async function chooseFile(chosen: File): Promise<void> {
    setBusy(true)
    clear()

    const xml = await chosen.text()
    const result = await importAuditFile({
      data: { xml, dryRun: true, idempotencyKey: importKey.current },
    })
    setBusy(false)

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((violation) => violationMessage(t, violation))
          : [result.problem.detail],
      )
      return
    }

    setPreview({ xml, report: result.data })
  }

  async function confirm(): Promise<void> {
    if (preview === null) return
    setBusy(true)
    setProblems(null)

    const result = await importAuditFile({
      data: { xml: preview.xml, dryRun: false, idempotencyKey: importKey.current },
    })
    setBusy(false)

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((violation) => violationMessage(t, violation))
          : [result.problem.detail],
      )
      return
    }

    const report = result.data
    // A fresh key: the next file is a different import, not a retry of this one.
    importKey.current = crypto.randomUUID()
    setPreview(null)
    if (file.current !== null) file.current.value = ''
    setNotice(
      t('auditFile.imported', {
        entries: String(report.posted),
        year: report.fiscalYear,
      }),
    )
    await router.invalidate()
  }

  return (
    <>
      <PageHeader title={t('auditFile.title')} description={t('auditFile.intro')} />

      {!years.ok && (
        <p role="alert" className="text-destructive text-sm">
          {years.problem.detail}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-border border p-4">
          <h2 className="text-base font-medium">{t('auditFile.exportTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('auditFile.exportBody')}</p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <SelectField
              label={t('auditFile.exportYear')}
              value={exportYear}
              onValueChange={setExportYear}
              disabled={!hydrated}
              placeholder={t('auditFile.pickYear')}
              className="w-56"
            >
              {options.map((year) => (
                <SelectOption key={year.code} value={year.code}>
                  {`${year.code} (${formatDate(year.startsOn)} – ${formatDate(year.endsOn)})`}
                </SelectOption>
              ))}
            </SelectField>

            {/* A link rather than a fetch: the response is XML with a filename
                on it, and the browser already knows what to do with that. */}
            <a
              href={`/api/v1/exports/audit-file?fiscalYear=${exportYear}`}
              className="border-input border px-4 py-2 text-sm font-medium"
            >
              {t('auditFile.export')}
            </a>
          </div>
        </section>

        <section className="border-border border p-4">
          <h2 className="text-base font-medium">{t('auditFile.importTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('auditFile.importBody')}</p>

          <label className="mt-4 block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('auditFile.file')}
            </span>
            <input
              ref={file}
              type="file"
              accept=".xml,text/xml,application/xml"
              disabled={!hydrated || busy}
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0]
                if (chosen !== undefined) void chooseFile(chosen)
              }}
              className="border-input bg-background w-full border px-3 py-2 text-sm"
            />
          </label>

          <p className="text-muted-foreground mt-2 text-xs">{t('auditFile.matchChartNote')}</p>

          {busy && preview === null && (
            <p className="text-muted-foreground mt-3 text-sm">{t('common.busy')}</p>
          )}
        </section>
      </div>

      {problems !== null && (
        <div role="alert" className="border-destructive mt-6 border p-4">
          <h2 className="text-destructive text-sm font-medium">{t('auditFile.refused')}</h2>
          <ul className="text-destructive mt-2 space-y-1 text-sm">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground mt-6 border p-3 text-sm">{notice}</p>
      )}

      {preview !== null && (
        <section className="border-border mt-6 border p-4">
          <h2 className="text-base font-medium">{t('auditFile.wouldDo')}</h2>

          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Figure label={t('auditFile.company')} value={preview.report.companyName} />
            <Figure label={t('auditFile.year')} value={preview.report.fiscalYear} tabular />
            <Figure
              label={t('auditFile.entries')}
              value={String(preview.report.entryCount)}
              tabular
            />
            <Figure
              label={t('auditFile.lines')}
              value={String(preview.report.reconciliation.actualLineCount)}
              tabular
            />
            <Figure
              label={t('auditFile.accountsInFile')}
              value={String(preview.report.accounts.total)}
              tabular
            />
            <Figure
              label={t('auditFile.newAccounts')}
              value={String(preview.report.accounts.new)}
              tabular
              tone={preview.report.accounts.new > 0 ? 'bad' : 'plain'}
            />
            <Figure
              label={t('auditFile.newJournals')}
              value={String(preview.report.journals.new)}
              tabular
              tone={preview.report.journals.new > 0 ? 'bad' : 'plain'}
            />
            <Figure
              label={t('auditFile.unmatchedContacts')}
              value={String(preview.report.contacts.unmatched)}
              tabular
              tone={preview.report.contacts.unmatched > 0 ? 'warn' : 'plain'}
            />
          </dl>

          {!preview.report.reconciliation.matches && (
            <p className="text-unreconciled mt-3 text-sm">
              {t('auditFile.controlTotalsDiffer', {
                declared: String(preview.report.reconciliation.declaredLineCount ?? '—'),
                actual: String(preview.report.reconciliation.actualLineCount),
              })}
            </p>
          )}

          {/* The whole of the alpha's answer to "this file needs accounts you do
              not have", said here rather than by a stack trace later. */}
          {!chartMatches && (
            <div role="alert" className="border-destructive mt-4 border p-3">
              <p className="text-destructive text-sm font-medium">
                {t('auditFile.chartMismatch', {
                  accounts: String(preview.report.accounts.new),
                  journals: String(preview.report.journals.new),
                })}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                {t('auditFile.chartMismatchWhat')}
              </p>
            </div>
          )}

          {preview.report.vatCodes.some((code) => !code.exists) && (
            <div className="mt-4">
              <h3 className="text-muted-foreground text-xs font-medium">
                {t('auditFile.unknownVatCodes')}
              </h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {preview.report.vatCodes
                  .filter((code) => !code.exists)
                  .map((code) => (
                    <li key={code.code} className="bg-unreconciled/15 px-2 py-1 tabular text-xs">
                      {code.code}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {preview.report.warnings.length > 0 && (
            <div className="mt-4">
              <h3 className="text-muted-foreground text-xs font-medium">
                {t('auditFile.warnings')}
              </h3>
              <ul className="text-unreconciled mt-1 space-y-1 text-sm">
                {preview.report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {chartMatches && (
              <button
                type="button"
                disabled={!hydrated || busy || preview.report.entryCount === 0}
                onClick={() => {
                  void confirm()
                }}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.busy') : t('auditFile.import')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                clear()
                if (file.current !== null) file.current.value = ''
              }}
              className="border-input border px-4 py-2 text-sm disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}
    </>
  )
}

/** One figure out of the report. `bad` is the status red, never the accent. */
function Figure({
  label,
  value,
  tabular = false,
  tone = 'plain',
}: {
  label: string
  value: string
  tabular?: boolean
  tone?: 'plain' | 'warn' | 'bad'
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={[
          tabular ? 'tabular' : '',
          tone === 'warn' ? 'text-unreconciled' : '',
          tone === 'bad' ? 'text-destructive' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}
