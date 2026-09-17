import { createHmac } from 'node:crypto'
import { describe as suite, expect, it } from 'vitest'
import { describe, type KloptEvent } from '../src/notifier.js'
import { verify } from '../src/verify.js'
import { createClient } from '../src/client.js'

/**
 * The example, tested like the module it is meant to be copied into.
 *
 * If these break, the public API changed in a way `docs/api-stability.md`
 * promised it would not — which is exactly the alarm an example in the
 * repository is for.
 */

const SECRET = 'whsec_example'
const NOW = 1_789_124_845

const sign = (body: string, at = NOW) =>
  `t=${String(at)},v1=${createHmac('sha256', SECRET)
    .update(`${String(at)}.${body}`)
    .digest('hex')}`

/** The delivery body, and the same thing parsed back — as a receiver sees it. */
const parsed = (type: string, id?: string): KloptEvent => JSON.parse(event(type, id)) as KloptEvent

const event = (type: string, id = 'a3f1c0de-0000-7000-8000-000000000001') =>
  JSON.stringify({
    id: '01890000-0000-7000-8000-0000000000aa',
    occurredAt: '2026-03-15T10:00:00.000Z',
    type,
    version: 1,
    entityId: '01890000-0000-7000-8000-0000000000bb',
    resource: { type: 'sales_invoice', id },
  })

/** A Klopt that answers from a fixture. No socket is opened. */
function fakeKlopt(routes: Record<string, unknown>) {
  const asked: string[] = []
  const client = createClient({
    baseUrl: 'https://books.example.test',
    token: 'klopt_example',
    fetch: ((url: string) => {
      const path = url.replace('https://books.example.test', '')
      asked.push(path)
      const body = routes[path]
      return Promise.resolve(
        body === undefined
          ? new Response(null, { status: 404 })
          : new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
      )
    }) as unknown as typeof globalThis.fetch,
  })

  return { client, asked }
}

suite('checking the signature', () => {
  it('accepts what Klopt signed', () => {
    const body = event('sales.invoice.issued')
    expect(verify(SECRET, body, sign(body), NOW)).toBe('ok')
  })

  it('refuses a tampered body, the wrong secret, and a replay', () => {
    const body = event('sales.invoice.issued')

    expect(verify(SECRET, `${body} `, sign(body), NOW)).toBe('mismatch')
    expect(verify('whsec_other', body, sign(body), NOW)).toBe('mismatch')
    expect(verify(SECRET, body, sign(body, NOW - 3600), NOW)).toBe('stale')
  })

  it('says so rather than throwing on a header that is not one', () => {
    const body = event('sales.invoice.issued')
    for (const header of ['', 'nonsense', 't=x,v1=y', 't=1,v1=ab']) {
      expect(verify(SECRET, body, header, NOW)).not.toBe('ok')
    }
  })
})

suite('describing an event', () => {
  it('fetches the invoice the event points at, and says something about it', async () => {
    const { client, asked } = fakeKlopt({
      '/api/v1/sales-invoices/a3f1c0de-0000-7000-8000-000000000001': {
        invoice: { number: '2026-0042', total: '1.210,00', contactName: 'Grote Klant N.V.' },
      },
    })

    const line = await describe(client, parsed('sales.invoice.issued'))

    expect(line).toBe('Factuur 2026-0042 verstuurd aan Grote Klant N.V. — 1.210,00')
    // The event carried no invoice; the module had to go and ask.
    expect(asked).toEqual(['/api/v1/sales-invoices/a3f1c0de-0000-7000-8000-000000000001'])
  })

  it('goes quiet when the token is not allowed to see it', async () => {
    // Nothing in the fixture, so the fake answers 404 as Klopt would for a
    // resource this token cannot reach. A module must not crash-loop on that.
    const { client } = fakeKlopt({})
    expect(await describe(client, parsed('sales.invoice.issued'))).toBeNull()
  })

  it('ignores a type it has never heard of, without asking Klopt anything', async () => {
    // New event types appear without warning — the stability promise says so.
    // A module that threw on one would break itself on somebody else's release.
    const { client, asked } = fakeKlopt({})

    expect(await describe(client, parsed('inventory.stock.counted'))).toBeNull()
    expect(asked).toEqual([])
  })

  it('says the aangifte is in without fetching anything', async () => {
    const { client, asked } = fakeKlopt({})

    expect(await describe(client, parsed('vat.return.filed'))).toBe('De BTW-aangifte is ingediend.')
    expect(asked).toEqual([])
  })
})
