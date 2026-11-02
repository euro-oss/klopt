import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { completeExactConnection } from '~/server/ledger'
import { saveImportWizardState } from '~/server/import-wizard'
import { useT } from '~/i18n/provider'

/**
 * Waar Exact de browser naartoe stuurt.
 *
 * Deze pagina is de geregistreerde redirect-URI. Hij doet één ding: de `code`
 * en `state` uit de URL naar de server sturen, die ze bij Exact inwisselt voor
 * een tokenpaar.
 *
 * Een pagina en niet een API-route, zodat het API-oppervlak methodes en bodies
 * blijft in plaats van een ingang te krijgen die alleen voor een redirect
 * betekenis heeft.
 *
 * De `code` is bij Exact eenmalig, dus dit tweemaal doen levert `invalid_grant`
 * op — vandaar de ref: een dubbele render mag de code niet opmaken voordat de
 * eerste poging klaar is.
 */
export const Route = createFileRoute('/_app/exact/callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search['code'] === 'string' ? search['code'] : '',
    state: typeof search['state'] === 'string' ? search['state'] : '',
    error: typeof search['error'] === 'string' ? search['error'] : '',
  }),
  component: ExactCallback,
})

function ExactCallback() {
  const { code, state, error } = Route.useSearch()
  const navigate = useNavigate()
  const attempted = useRef(false)
  const { t } = useT()
  const [failure, setFailure] = useState<string | null>(error === '' ? null : error)

  useEffect(() => {
    if (attempted.current || code === '' || state === '' || error !== '') return
    attempted.current = true

    void (async () => {
      const result = await completeExactConnection({
        data: { code, state, idempotencyKey: crypto.randomUUID() },
      })

      if (!result.ok) {
        setFailure(result.problem.detail)
        return
      }
      // Import wizard (#100): land on Administratie after Exact consent.
      // `van=exact-oauth` skips Welkom terug — this is still the same flow,
      // not a later return to a mid-import session.
      await saveImportWizardState({
        data: {
          source: 'exact',
          step: 'administratie',
          idempotencyKey: crypto.randomUUID(),
        },
      })
      void navigate({ to: '/importeren', search: { bron: 'exact', van: 'exact-oauth' } })
    })()
  }, [code, state, error, navigate])

  return (
    <>
      <PageHeader title={t('exact.title')} description={t('exactCallback.finishing')} />
      {failure === null ? (
        <p role="status" className="text-muted-foreground text-sm">
          {code === '' ? t('exactCallback.noCode') : t('exactCallback.wait')}
        </p>
      ) : (
        <>
          <p role="alert" className="text-destructive text-sm">
            {failure}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('exactCallback.startOver')}{' '}
            <a href="/importeren?bron=exact" className="underline">
              {t('exactCallback.exactPage')}
            </a>
            .
          </p>
        </>
      )}
    </>
  )
}
