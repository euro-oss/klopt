import { describe, expect, it, vi } from 'vitest'
import { createMoneybirdClient, MoneybirdApiError } from '../../src/index.js'
import { collectAll } from '../../src/moneybird/index.js'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function client(fetch: ReturnType<typeof vi.fn>) {
  return createMoneybirdClient({
    token: 'mb-token',
    fetch: fetch as unknown as typeof globalThis.fetch,
  })
}

describe('the Moneybird client', () => {
  it('sends the personal token as a Bearer header', async () => {
    const fetch = vi.fn().mockResolvedValue(json([]))
    await client(fetch).administrations()
    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer mb-token')
    expect(String(fetch.mock.calls[0]![0])).toContain('/administrations.json')
  })

  it('pages until a short page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, index) => ({ id: index }))))
      .mockResolvedValueOnce(json([{ id: 100 }]))
    const rows = await collectAll(client(fetch), {
      administrationId: '1',
      path: 'contacts.json',
    })
    expect(rows).toHaveLength(101)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('records a refused request rather than inventing an empty page', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('no', { status: 403 }))
    const moneybird = client(fetch)
    await expect(
      moneybird.page({ administrationId: '1', path: 'contacts.json' }),
    ).rejects.toBeInstanceOf(MoneybirdApiError)
    expect(moneybird.log[0]).toMatchObject({ status: 403 })
  })
})
