import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { issueApiToken, revokeApiToken, revokeAuthorisedApp } from '~/server/ledger'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'

/**
 * API tokens and the apps holding them (spec 14).
 *
 * On the Toegang screen because that is where the README has been sending
 * people since before any of this existed — "issue a read-only token under
 * Toegang" was an instruction for a screen that had no tokens on it.
 *
 * ## The secret appears once
 *
 * Only a hash is kept, so there is no way to show it again and no endpoint
 * that could. The screen says so before anybody clicks, rather than after they
 * have closed the panel.
 */

interface TokenRow {
  readonly id: string
  readonly name: string
  readonly prefix: string
  readonly permissions: readonly string[]
  readonly actorKind: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly expiresAt: string | null
  readonly state: 'live' | 'expired' | 'revoked'
  readonly oauthClientId: string | null
  readonly oauthClientName: string | null
}

type Result =
  | { ok: true; data: { tokens: readonly TokenRow[]; grantableScopes: readonly string[] } }
  | { ok: false; problem?: { detail: string } }

const STATE_KEY: Record<TokenRow['state'], MessageKey> = {
  live: 'tokens.state.live',
  expired: 'tokens.state.expired',
  revoked: 'tokens.state.revoked',
}

export function TokenSection({ result }: { result: Result }) {
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'draft'>('read')
  const { t } = useT()

  if (!result.ok) {
    // `tokens:manage` is owner-only, so a bookkeeper simply does not see this.
    return null
  }

  const { tokens } = result.data

  /**
   * These server functions report failure, they do not throw it.
   *
   * `run()` on the server wraps everything into `{ ok, problem }`, so a
   * `try/catch` around one catches nothing and the screen cheerfully refreshes
   * as though the revoke had worked. It had not — the token was still live and
   * the only sign was that the row did not change.
   */
  const run = async (work: () => Promise<{ ok: boolean; problem?: { detail: string } }>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await work()
      if (!result.ok) {
        setError(result.problem?.detail ?? t('common.unknownError'))
        return
      }
      await router.invalidate()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('common.unknownError'))
    } finally {
      setBusy(false)
    }
  }

  const issue = () =>
    run(async () => {
      const response = await issueApiToken({
        data: {
          name,
          /**
           * Two named choices, never `*`.
           *
           * `*` was the first attempt and it could not even be issued: a token
           * cannot exceed the person issuing it, and no human role holds `*` —
           * so the option was broken for everybody who tried it.
           *
           * `ledger:draft` is the interesting one. It creates drafts and
           * cannot issue, book or send, so "an agent drafts; a human releases"
           * holds for the token itself rather than only for the MCP tool list.
           */
          permissions:
            scope === 'read'
              ? ['ledger:read', 'ledger:export']
              : ['ledger:read', 'ledger:export', 'ledger:draft'],
          expiresInDays: 90,
          idempotencyKey: crypto.randomUUID(),
        },
      })
      if (response.ok) {
        setIssued({ name, token: response.data.token })
        setName('')
      }
      return response
    })

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t('tokens.title')}</h2>
      <p className="text-muted-foreground mt-1 mb-4 max-w-2xl text-sm">{t('tokens.intro')}</p>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {issued !== null && (
        <div className="border-border bg-muted/40 mb-4 rounded-md border p-4">
          <p className="text-sm font-medium">{t('tokens.issued', { name: issued.name })}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('tokens.issuedOnce')}</p>
          <code className="mt-2 block overflow-x-auto rounded bg-muted p-2 tabular text-xs">
            {issued.token}
          </code>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="border-border mt-3 rounded-md border px-2 py-1 text-xs"
          >
            {t('tokens.saved')}
          </button>
        </div>
      )}

      <div className="border-border mb-6 flex max-w-2xl items-end gap-3 rounded-md border p-4">
        <label className="flex-1 text-sm">
          {t('tokens.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!hydrated}
            placeholder={t('tokens.namePlaceholder')}
            className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
          />
        </label>
        <SelectField
          label={t('tokens.whatItMay')}
          value={scope}
          onValueChange={(next) => {
            setScope(next === 'draft' ? 'draft' : 'read')
          }}
          disabled={!hydrated}
          triggerClassName="w-56"
        >
          <SelectOption value="read">{t('tokens.readOnly')}</SelectOption>
          <SelectOption value="draft">{t('tokens.readAndDraft')}</SelectOption>
        </SelectField>
        <button
          type="button"
          disabled={busy || !hydrated || name.trim() === ''}
          onClick={() => void issue()}
          className="bg-primary text-primary-foreground mb-1 rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('tokens.create')}
        </button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('tokens.empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b text-left">
              <th className="py-2">{t('tokens.name')}</th>
              <th className="py-2">{t('tokens.whatItMay')}</th>
              <th className="py-2">{t('tokens.lastUsed')}</th>
              <th className="py-2">{t('invoices.status')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id} className="border-border border-b">
                <td className="py-2">
                  {token.oauthClientName ?? token.name}
                  <span className="text-muted-foreground ml-2 tabular text-xs">
                    {token.prefix}…
                  </span>
                  {token.oauthClientName !== null && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {t('tokens.connectedApp')}
                    </span>
                  )}
                </td>
                <td className="text-muted-foreground py-2 text-xs">
                  {token.permissions.includes('*')
                    ? t('tokens.everything')
                    : token.permissions.join(', ')}
                </td>
                <td className="text-muted-foreground py-2 text-xs">
                  {token.lastUsedAt === null ? t('tokens.never') : formatDate(token.lastUsedAt)}
                </td>
                <td className="py-2 text-xs">
                  <span className={token.state === 'live' ? '' : 'text-muted-foreground'}>
                    {t(STATE_KEY[token.state])}
                  </span>
                </td>
                <td className="py-2 text-right">
                  {token.state === 'live' && (
                    <button
                      type="button"
                      // `!hydrated` matters as much as `busy`. Without it the
                      // button renders live before React attaches its handler,
                      // so an early click does nothing at all and says nothing
                      // — which is how a revoke silently fails to happen.
                      disabled={busy || !hydrated}
                      onClick={() =>
                        void run(() =>
                          token.oauthClientId === null
                            ? revokeApiToken({ data: { tokenId: token.id } })
                            : revokeAuthorisedApp({ data: { clientId: token.oauthClientId } }),
                        )
                      }
                      className="border-border rounded-md border px-2 py-1 text-xs"
                    >
                      {token.oauthClientId === null ? t('tokens.revoke') : t('tokens.disconnect')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
