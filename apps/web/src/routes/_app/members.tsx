import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '~/components/app-shell'
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
  loader: async () => ({ access: await listMembers() }),
  component: Members,
})

const ROLES = [
  { value: 'owner', label: 'Eigenaar', hint: 'Alles, inclusief toegang en tokens beheren.' },
  { value: 'bookkeeper', label: 'Boekhouder', hint: 'Boeken en inrichten. Geen jaarafsluiting.' },
  {
    value: 'accountant',
    label: 'Accountant',
    hint: 'Ook boeken in een zachtgesloten periode, en afsluiten.',
  },
  { value: 'auditor', label: 'Controleur', hint: 'Alleen lezen en exporteren.' },
] as const

/**
 * What every server function here hands back: the data, or a problem document
 * with the violations intact. See `~/server/internal`.
 */
type Outcome<T> = { ok: true; data: T } | { ok: false; problem: { detail: string } }

function roleLabel(role: string): string {
  return ROLES.find((item) => item.value === role)?.label ?? role
}

function Members() {
  const { access } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

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
        if (body.joinedImmediately) return `${body.email} heeft nu toegang.`
        if (body.delivered) return `Uitnodiging verstuurd naar ${body.email}.`

        // Either there is no mail server here, or there is one and it refused.
        // The invitation is good either way — signing in with the address is
        // what claims it — so the difference is only in what to do about it.
        const tail = 'Ze kunnen zich aanmelden met dit adres en staan er dan meteen in.'
        if (body.transport === 'log') {
          return (
            `${body.email} is uitgenodigd. Er is geen mailserver ingesteld, ` +
            `dus het bericht staat in het log. ${tail}`
          )
        }
        return (
          `${body.email} is uitgenodigd, maar het bericht kon niet worden verstuurd` +
          `${body.deliveryError === null ? '' : ` (${body.deliveryError})`}. ${tail}`
        )
      },
    )
  }

  return (
    <>
      <PageHeader title="Toegang" description="Wie deze administratie mag zien, en in welke rol." />

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
            <th className="py-2 font-medium">E-mail</th>
            <th className="py-2 font-medium">Rol</th>
            <th className="py-2 font-medium">Status</th>
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
                <select
                  aria-label={`Rol van ${member.email}`}
                  value={member.role}
                  disabled={busy || !hydrated}
                  onChange={(event) => {
                    const role = event.target.value
                    void act(
                      () => setMemberRole({ data: { memberId: member.userId, role } }),
                      () => `${member.email} is nu ${roleLabel(role).toLowerCase()}.`,
                    )
                  }}
                  className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="text-muted-foreground py-2 text-xs">
                lid sinds {member.since.slice(0, 10)}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void act(
                      () => removeMember({ data: { memberId: member.userId } }),
                      () => `${member.email} heeft geen toegang meer.`,
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                >
                  Verwijderen
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
                    uitnodiging verlopen op {invitation.expiresAt.slice(0, 10)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    uitgenodigd, nog niet aangemeld — verloopt {invitation.expiresAt.slice(0, 10)}
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
                      () => `De uitnodiging voor ${invitation.email} is ingetrokken.`,
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                >
                  Intrekken
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={onInvite} className="mt-8 max-w-xl">
        <h2 className="text-base font-medium">Iemand uitnodigen</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Ze krijgen een bericht en melden zich aan met dit adres. Heeft het adres al een account,
          dan is de toegang meteen geregeld.
        </p>

        <div className="mt-4 flex gap-3">
          <label className="flex-1">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">E-mail</span>
            <input
              name="email"
              type="email"
              required
              placeholder="accountant@kantoor.nl"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Rol</span>
            <select
              aria-label="Rol"
              name="role"
              defaultValue="bookkeeper"
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={busy || !hydrated}
          className="bg-primary text-primary-foreground mt-4 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Bezig…' : 'Uitnodigen'}
        </button>
      </form>

      <dl className="text-muted-foreground mt-8 max-w-xl space-y-1 text-xs">
        {ROLES.map((role) => (
          <div key={role.value} className="flex gap-2">
            <dt className="text-foreground w-24 shrink-0 font-medium">{role.label}</dt>
            <dd>{role.hint}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
