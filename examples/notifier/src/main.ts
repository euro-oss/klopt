import { createServer } from 'node:http'
import { createClient } from './client.js'
import { describe, type KloptEvent } from './notifier.js'
import { verify } from './verify.js'

/**
 * A Klopt module, in about sixty lines.
 *
 * Receives webhooks, checks the signature, looks the resource up with its own
 * token, and prints a line. Replace the `console.info` with a Slack post and
 * this is a real integration.
 *
 * Run it with:
 *
 *     KLOPT_URL=https://books.example.nl \
 *     KLOPT_TOKEN=klopt_... \
 *     KLOPT_WEBHOOK_SECRET=whsec_... \
 *     node dist/main.js
 *
 * Then add `https://your-host/webhook` under Webhooks in Klopt, and paste the
 * secret it shows you once into `KLOPT_WEBHOOK_SECRET`.
 */

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    console.error(`${name} is not set.`)
    process.exit(1)
  }
  return value
}

const baseUrl = required('KLOPT_URL')
const secret = required('KLOPT_WEBHOOK_SECRET')
const klopt = createClient({ baseUrl, token: required('KLOPT_TOKEN') })

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/webhook') {
    response.writeHead(404).end()
    return
  }

  // Collected as raw text and verified before parsing: the signature is over
  // the bytes that were sent, and a parse-then-restringify does not reproduce
  // them.
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))

  request.on('end', () => {
    void (async () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const header = request.headers['klopt-signature']

      const verdict = verify(
        secret,
        raw,
        typeof header === 'string' ? header : '',
        Math.floor(Date.now() / 1000),
      )

      if (verdict !== 'ok') {
        console.warn(`[notifier] refused a delivery: ${verdict}`)
        // 401, not 400: this is about who sent it. Klopt treats any non-2xx as
        // a failure and will retry, which is right — if the secret is wrong,
        // somebody has to fix it, and a silent 200 would hide that.
        response.writeHead(401).end()
        return
      }

      try {
        const event = JSON.parse(raw) as KloptEvent
        const line = await describe(klopt, event)
        if (line !== null) console.info(`[notifier] ${line}`)

        // 200 even for an event we ignored. Klopt's cursor only advances on a
        // 2xx, and refusing a type we do not care about would stop the whole
        // stream behind it.
        response.writeHead(200).end()
      } catch (cause: unknown) {
        console.error('[notifier] could not handle a delivery', cause)
        response.writeHead(500).end()
      }
    })()
  })
})

const port = Number(process.env['PORT'] ?? '4000')
server.listen(port, () => {
  console.info(`[notifier] listening on :${String(port)}, talking to ${baseUrl}`)
})
