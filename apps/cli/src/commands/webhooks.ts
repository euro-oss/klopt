import type { Command } from './registry.js'
import { optionOf } from './registry.js'

/**
 * Replaying a webhook (spec 10.4).
 *
 * The 23:00 command. An integration was down, it is back, and the queue behind
 * it has stopped — because delivery is ordered and the cursor does not advance
 * past a failure. This both rewinds and switches the endpoint back on, which
 * are the same act from an operator's side.
 */
export const webhooksReplay: Command = {
  name: 'webhooks-replay',
  summary: 'Send the event stream again from a point, and re-enable the endpoint.',
  usage: 'klopt webhooks-replay [<endpoint-id>] [--after <event-id>]',
  options: { after: 'string' },
  operations: ['webhooks.replay', 'webhooks.list'],

  async run({ client, args, out, err }) {
    if (client === null) {
      err('Not signed in. Run `klopt login`, or set KLOPT_TOKEN.')
      return 1
    }

    const listed = (await client.get('/webhooks')) as {
      endpoints?: {
        id: string
        url: string
        enabled: boolean
        backlog: number
        disabledReason: string | null
      }[]
    }
    const endpoints = listed.endpoints ?? []

    const id = args.positional[0] ?? (endpoints.length === 1 ? endpoints[0]!.id : undefined)

    if (id === undefined) {
      err(
        endpoints.length === 0 ? 'There are no webhook endpoints.' : 'Which endpoint? Pass one of:',
      )
      for (const endpoint of endpoints) {
        const state = endpoint.enabled ? 'live' : `off — ${endpoint.disabledReason ?? 'no reason'}`
        err(`  ${endpoint.id}  ${endpoint.url}  ${String(endpoint.backlog)} waiting, ${state}`)
      }
      return 2
    }

    const after = optionOf(args, 'after') ?? null
    const result = (await client.post(`/webhooks/${id}/replay`, { after })) as {
      replayingFrom?: string | null
    }

    out(
      result.replayingFrom == null
        ? 'Replaying from the beginning. The endpoint is on again.'
        : `Replaying from ${result.replayingFrom}. The endpoint is on again.`,
    )
    out('Deliveries are at-least-once: the receiver will see events it has already seen.')
    return 0
  },
}

/** Reading the stream, which is what you do when a webhook did not arrive. */
export const events: Command = {
  name: 'events',
  summary: 'Read the event stream from a cursor.',
  usage: 'klopt events [--after <event-id>] [--type sales.invoice.issued] [--limit 50]',
  options: { after: 'string', type: 'string', limit: 'string' },
  operations: ['events.list'],

  async run({ client, args, out, err }) {
    if (client === null) {
      err('Not signed in. Run `klopt login`, or set KLOPT_TOKEN.')
      return 1
    }

    const page = (await client.get('/events', {
      after: optionOf(args, 'after'),
      type: optionOf(args, 'type'),
      limit: optionOf(args, 'limit') ?? '50',
    })) as {
      events?: { id: string; occurredAt: string; type: string; resource: { id: string | null } }[]
      nextCursor?: string | null
    }

    for (const event of page.events ?? []) {
      out(`${event.occurredAt}  ${event.type.padEnd(28)} ${event.resource.id ?? ''}`)
    }

    if (page.nextCursor != null) out(`\nnext: --after ${page.nextCursor}`)
    else out('\nNothing further. Keep the cursor you have.')
    return 0
  },
}
