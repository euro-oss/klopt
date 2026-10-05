import { describe, expect, it, vi } from 'vitest'
import { collectAll, createMoneybirdClient, MoneybirdApiError } from '../../src/index.js'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('the Moneybird client', () => {
  it('sends the personal token as a Bearer header', async () => {
    const fetch = vi.fn().mockResolvedValue(json([]))
    const client = createMoneybirdClient({
      token: 'mb-token',
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await client.administrations()
    const headers = new Headers(fetch.mock.calls[0]![1].headers as HeadersInit)
    expect(headers.get('authorization')).toBe('Bearer mb-token')
    expect(String(fetch.mock.calls[0]![0])).toContain('/administrations.json')
  })

  it('pages until a short page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, index) => ({ id: index }))))
      .mockResolvedValueOnce(json([{ id: 100 }]))
    const client = createMoneybirdClient({
      token: 'mb-token',
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    const rows = await collectAll(client, { administrationId: '1', path: 'contacts.json' })
    expect(rows).toHaveLength(101)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('records a refused request rather than inventing an empty page', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('no', { status: 403 }))
    const client = createMoneybirdClient({
      token: 'mb-token',
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await expect(
      client.page({ administrationId: '1', path: 'contacts.json' }),
    ).rejects.toBeInstanceOf(MoneybirdApiError)
    expect(client.log[0]).toMatchObject({ status: 403 })
  })
})
