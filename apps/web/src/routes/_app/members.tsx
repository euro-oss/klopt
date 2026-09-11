import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listTokens } from '~/server/ledger'
import { PageHeader } from '~/components/app-shell'
import { TokenSection as Tokens } from '~/components/tokens'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { inviteMember, listMembers, removeMember, setMemberRole } from '~/server/members'

/**
 * Who can see these books (spec 4).
 *
 * Members and outstanding invitations in one list, because the difference —
 * "has signed in yet" — is not something the person doing the inviting has any
 * reason to think about. An invitation that has expired stays on the list and
 * says so: "I invited them and nothing happened" is exactly the case where
 * hiding the row is unhelpful.
 *
 * Owner-only. The nav entry is hidden for everyone else and the API refuses
 * them, in that order of politeness.
 */
export const Route = createFileRoute('/_app/members')({
  loader: async () => ({ access: await listMembers(), tokens: await listTokens() }),
  component: Members,
})

const ROLES = [
  { value: 'owner', label: 'members.role.owner', hint: 'members.role.ownerHint' },
  { value: 'bookkeeper', label: 'members.role.bookkeeper', hint: 'members.role.bookkeeperHint' },
  { value: 'accountant', label: 'members.role.accountant', hint: 'members.role.accountantHint' },
  { value: 'auditor', label: 'members.role.auditor', hint: 'members.role.auditorHint' },
] as const satisfies readonly { value: string; label: MessageKey; hint: MessageKey }[]

/**
 * What every server function here hands back: the data, or a problem document
 * with the violations intact. See `~/server/internal`.
 */
type Outcome<T> = { ok: true; data: T } | { ok: false; problem: { detail: string } }

/** The role's name in the reader's language; the raw value if it is not one we know. */
function useRoleLabel(): (role: string) => string {
  const { t } = useT()
  return (role) => {
    const key = ROLES.find((item) => item.value === role)?.label
    return key === undefined ? role : t(key)
  }
}

function Members() {
  const { access, tokens: tokensResult } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()
  const roleLabel = useRoleLabel()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!access.ok) {
    return (
      <>
        <PageHeader title="Toegang" />
        <p role="alert" className="text-destructive text-sm">
          {access.problem.detail}
        </p>
      </>
    )
  }

  const { members, invitations } = access.data

  async function act<T>(
    work: () => Promise<Outcome<T>>,
    onOk: (data: T) => string | null,
  ): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)

    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }

    setNotice(onOk(result.data))
    await router.invalidate()
  }

  function onInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const read = (key: string): string => {
      const value = form.get(key)
      return typeof value === 'string' ? value.trim() : ''
    }
    const email = read('email')
    if (email === '') return

    event.currentTarget.reset()

    void act(
      () => inviteMember({ data: { email, role: read('role') } }),
      (body) => {
        if (body.joinedImmediately) return t('members.hasAccessNow', { email: body.email })
        if (body.delivered) return t('members.inviteSent', { email: body.email })

        // Either there is no mail server here, or there is one and it refused.
        // The invitation is good either way — signing in with the address is
        // what claims it — so the difference is only in what to do about it.
        const tail = t('members.inviteTail')
        if (body.transport === 'log') {
          return t('members.inviteLogged', { email: body.email, tail })
        }
        return t('members.inviteUndelivered', {
          email: body.email,
          why: body.deliveryError === null ? '' : ` (${body.deliveryError})`,
          tail,
        })
      },
    )
  }

  return (
    <>
      <PageHeader title={t('members.title')} description={t('members.intro')} />

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

      <table className="w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-medium">{t('members.email')}</th>
            <th className="py-2 font-medium">{t('members.role')}</th>
            <th className="py-2 font-medium">{t('invoices.status')}</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId} className="border-border border-b">
              <td className="py-2">
                {member.email}
                {member.name !== '' && member.name !== member.email && (
                  <span className="text-muted-foreground"> · {member.name}</span>
                )}
              </td>
              <td className="py-2">
                <SelectField
                  label={t('members.roleOf', { email: member.email })}
                  labelHidden
                  value={member.role}
                  disabled={busy || !hydrated}
                  triggerClassName="h-8"
                  onValueChange={(role) => {
                    void act(
                      () => setMemberRole({ data: { memberId: member.userId, role } }),
                      () =>
                        t('members.roleChanged', {
                          email: member.email,
                          role: roleLabel(role).toLowerCase(),
                        }),
                    )
                  }}
                >
                  {ROLES.map((role) => (
                    <SelectOption key={role.value} value={role.value}>
                      {t(role.label)}
                    </SelectOption>
                  ))}
                </SelectField>
              </td>
              <td className="text-muted-foreground py-2 text-xs">
                {t('members.memberSince', { date: member.since.slice(0, 10) })}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void act(
                      () => removeMember({ data: { memberId: member.userId } }),
                      () => t('members.accessRemoved', { email: member.email }),
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                >
                  {t('members.remove')}
                </button>
              </td>
            </tr>
          ))}

          {invitations.map((invitation) => (
            <tr key={invitation.invitationId} className="border-border border-b">
              <td className="py-2">{invitation.email}</td>
              <td className="text-muted-foreground py-2">{roleLabel(invitation.role)}</td>
              <td className="py-2 text-xs">
                {invitation.expired ? (
                  <span className="text-unreconciled">
                    {t('members.inviteExpired', { date: invitation.expiresAt.slice(0, 10) })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t('members.invitePending', { date: invitation.expiresAt.slice(0, 10) })}
                  </span>
                )}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void act(
                      () => removeMember({ data: { memberId: invitation.invitationId } }),
                      () => t('members.inviteRevoked', { email: invitation.email }),
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                >
                  {t('members.revoke')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={onInvite} className="mt-8 max-w-xl">
        <h2 className="text-base font-medium">{t('members.inviteSomebody')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('members.inviteIntro')}</p>

        <div className="mt-4 flex gap-3">
          <label className="flex-1">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('members.email')}
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="accountant@kantoor.nl"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <SelectField
            label={t('members.role')}
            name="role"
            defaultValue="bookkeeper"
            disabled={!hydrated}
            triggerClassName="w-40"
          >
            {ROLES.map((role) => (
              <SelectOption key={role.value} value={role.value}>
                {t(role.label)}
              </SelectOption>
            ))}
          </SelectField>
        </div>

        <button
          type="submit"
          disabled={busy || !hydrated}
          className="bg-primary text-primary-foreground mt-4 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('members.invite')}
        </button>
      </form>

      <dl className="text-muted-foreground mt-8 max-w-xl space-y-1 text-xs">
        {ROLES.map((role) => (
          <div key={role.value} className="flex gap-2">
            <dt className="text-foreground w-24 shrink-0 font-medium">{t(role.label)}</dt>
            <dd>{t(role.hint)}</dd>
          </div>
        ))}
      </dl>

      <Tokens result={tokensResult} />
    </>
  )
}
