import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMigrations } from '@klopt/db'

/**
 * Invoice PDF against the built server, not `vite dev`.
 *
 * pdfkit loads Helvetica at runtime through `createRequire(import.meta.url)`
 * and the `#standard-fonts/*` package imports. `vite dev` resolves that from
 * the real package. The production bundle in `.output/server/_ssr` does not,
 * unless pdfkit stays external and Nitro copies the package into the server
 * output. Playwright's suite starts `vite dev`, so it stays green either way.
 * This script is what fails when the bundle is wrong.
 *
 * It is the first step of `pnpm --filter @klopt/web run test:e2e`, which is
 * the command the CI `e2e` job already runs, after `pnpm run build`. No
 * workflow file is involved.
 *
 * What it proves, on the process that is `node .output/server/index.mjs`:
 * a PDF download is 200, `application/pdf`, and starts with `%PDF`; and one
 * invoice send lands in the same file outbox the browser suite reads, with
 * the PDF named as an attachment. The outbox records the filename and the
 * content type, not the bytes — the download is what checks the bytes.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(WEB_ROOT, '..', '..')
const SERVER_ENTRY = join(WEB_ROOT, '.output', 'server', 'index.mjs')
/** Same directory `playwright.config.ts` points `KLOPT_EMAIL_OUTBOX_DIR` at. */
const OUTBOX = join(WEB_ROOT, 'e2e', '.outbox')
const REFERENCE_DATA = join(REPO_ROOT, 'reference-data')
const PORT = 3401
const BASE = `http://127.0.0.1:${String(PORT)}`
/**
 * Production refuses to boot unless this is `https://`, so the session cookie
 * is Secure. The check still dials the plain listener; Node sends the cookie
 * we were given, which a browser would not over http.
 */
const PUBLIC_ORIGIN = 'https://klopt.prod-pdf.test'

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

interface ProblemBody {
  readonly detail?: string
  readonly code?: string
  readonly violations?: readonly { readonly message?: string }[]
}

function fail(message: string): never {
  throw new Error(message)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message)
}

async function readBody(response: Response): Promise<{ text: string; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { bytes, text: new TextDecoder().decode(bytes) }
}

function problemSnippet(text: string): string {
  try {
    const problem = JSON.parse(text) as ProblemBody
    const violations = (problem.violations ?? [])
      .map((item) => item.message)
      .filter((item): item is string => item !== undefined)
    const detail = problem.detail ?? text.slice(0, 500)
    return violations.length === 0 ? detail : `${detail} (${violations.join('; ')})`
  } catch {
    return text.slice(0, 500)
  }
}

class Client {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly serverLogs: () => string) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; headers: Headers; text: string; bytes: Uint8Array }> {
    const headers = new Headers({
      origin: PUBLIC_ORIGIN,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'klopt.prod-pdf.test',
    })
    const cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    if (cookie !== '') headers.set('cookie', cookie)
    if (body !== undefined) {
      headers.set('content-type', 'application/json')
      headers.set('idempotency-key', randomUUID())
    }

    let response: Response
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        redirect: 'manual',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      fail(`${method} ${path} failed: ${reason}\n${this.serverLogs()}`)
    }

    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';', 1)[0]
      if (pair === undefined) continue
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }

    const read = await readBody(response)
    return { status: response.status, headers: response.headers, ...read }
  }
}

function outboxMessages(): readonly string[] {
  if (!existsSync(OUTBOX)) return []
  return readdirSync(OUTBOX)
    .filter((name) => name.endsWith('.txt'))
    .map((name) => readFileSync(join(OUTBOX, name), 'utf8'))
}

async function codeFor(email: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    for (const message of outboxMessages()) {
      if (!message.includes(`To: ${email}`)) continue
      const match = /^\s{4}(\d{6})\s*$/m.exec(message)
      if (match?.[1] !== undefined) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  fail(`No sign-in code was delivered to ${email}.`)
}

function invoiceMessage(email: string): string | undefined {
  return outboxMessages().find(
    (message) => message.includes(`To: ${email}`) && message.includes('X-Klopt-Attachment:'),
  )
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000
  let last = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Built server exited ${String(child.exitCode)} before it listened.\n${last}`)
    }
    try {
      const response = await fetch(`${BASE}/api/v1/health`)
      if (response.ok) return
      last = `health ${String(response.status)}`
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  fail(`Built server did not become ready: ${last}`)
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

function requireBuild(): void {
  if (!existsSync(SERVER_ENTRY)) {
    fail(
      `Missing ${SERVER_ENTRY}. Run \`pnpm --filter @klopt/web run build\` (or \`pnpm run build\`) first. ` +
        'This check imports nothing from vite dev.',
    )
  }
  const schematron = join(REFERENCE_DATA, 'peppol', 'bis-3')
  for (const name of ['CEN-EN16931-UBL.sch', 'PEPPOL-EN16931-UBL.sch']) {
    if (!existsSync(join(schematron, name))) {
      fail(
        `Missing ${join(schematron, name)}. Run \`pnpm run peppol:fetch\` — a send validates UBL.`,
      )
    }
  }
}

async function main(): Promise<void> {
  requireBuild()
  await runMigrations(DATABASE_URL)

  const logs: string[] = []
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_URL,
      KLOPT_AUTH_SECRET: 'prod-pdf-secret-not-for-production-0123456789',
      KLOPT_RATE_LIMIT: 'off',
      KLOPT_BASE_URL: PUBLIC_ORIGIN,
      KLOPT_EMAIL_OUTBOX_DIR: OUTBOX,
      KLOPT_DOCUMENT_DIR: join(WEB_ROOT, 'e2e', '.documents'),
      KLOPT_S3_ENDPOINT: '',
      KLOPT_ENCRYPTION_KEY: 'e2e-encryption-key-not-for-production-01234',
      KLOPT_REFERENCE_DATA_DIR: REFERENCE_DATA,
      KLOPT_HEADLESS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const capture = (chunk: Buffer) => {
    logs.push(chunk.toString())
    if (logs.length > 400) logs.shift()
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  const serverLogs = () => logs.join('').slice(-8_000)

  const client = new Client(serverLogs)
  const stamp = `${Date.now().toString()}-${randomUUID().slice(0, 8)}`
  const signer = `prod-pdf-${stamp}@example.test`
  const buyer = `inkoop-${stamp}@example.test`
  const year = String(new Date().getUTCFullYear())

  try {
    await waitForServer(child)

    const otp = await client.request('POST', '/api/auth/email-otp/send-verification-otp', {
      email: signer,
      type: 'sign-in',
    })
    assert(
      otp.status === 200,
      `Sign-in code was not sent (${String(otp.status)}): ${problemSnippet(otp.text)}\n${serverLogs()}`,
    )
    const code = await codeFor(signer)

    const signedIn = await client.request('POST', '/api/auth/sign-in/email-otp', {
      email: signer,
      otp: code,
    })
    assert(
      signedIn.status === 200,
      `Sign-in failed (${String(signedIn.status)}): ${problemSnippet(signedIn.text)}\n${serverLogs()}`,
    )

    const entityId = randomUUID()
    const created = await client.request('PUT', `/api/v1/entities/${entityId}`, {
      name: 'Prod PDF BV',
      legalName: 'Prod PDF Beheer B.V.',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      firstFiscalYear: year,
    })
    assert(
      created.status === 201 || created.status === 200,
      `Could not create an administration (${String(created.status)}): ${problemSnippet(created.text)}\n${serverLogs()}`,
    )

    const seller = await client.request('PATCH', '/api/v1/entity', {
      legalName: 'Prod PDF Beheer B.V.',
      street: 'Keizersgracht',
      houseNumber: '123-B',
      postalCode: '1015 CJ',
      city: 'Amsterdam',
      countryCode: 'NL',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      iban: 'NL02ABNA0123456789',
    })
    assert(
      seller.status === 200,
      `Could not store seller details (${String(seller.status)}): ${problemSnippet(seller.text)}\n${serverLogs()}`,
    )

    const contact = await client.request('POST', '/api/v1/contacts', {
      number: `DEB-${stamp.slice(-12)}`,
      name: 'Grote Klant N.V.',
      isCustomer: true,
      kvkNumber: '87654321',
      vatNumber: 'NL987654321B01',
      email: buyer,
      address: {
        street: 'Coolsingel',
        houseNumber: '42',
        postalCode: '3011 AD',
        city: 'Rotterdam',
        countryCode: 'NL',
      },
    })
    assert(
      contact.status === 201,
      `Could not create a customer (${String(contact.status)}): ${problemSnippet(contact.text)}\n${serverLogs()}`,
    )
    const contactBody = JSON.parse(contact.text) as { number?: string }
    const contactNumber = contactBody.number
    assert(
      contactNumber !== undefined,
      `Contact response had no number: ${contact.text.slice(0, 300)}`,
    )

    const draft = await client.request('POST', '/api/v1/sales-invoices', {
      contactNumber,
      issueDate: `${year}-01-15`,
      buyerReference: 'KOSTENPLAATS-42',
      lines: [
        {
          description: 'Advieswerk',
          quantity: '10',
          unitCode: 'HUR',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    })
    assert(
      draft.status === 201,
      `Could not draft an invoice (${String(draft.status)}): ${problemSnippet(draft.text)}\n${serverLogs()}`,
    )
    const draftBody = JSON.parse(draft.text) as { id?: string }
    const invoiceId = draftBody.id
    assert(invoiceId !== undefined, `Draft response had no id: ${draft.text.slice(0, 300)}`)

    const issued = await client.request('POST', `/api/v1/sales-invoices/${invoiceId}/issue`, {})
    assert(
      issued.status === 200,
      `Could not issue the invoice (${String(issued.status)}): ${problemSnippet(issued.text)}\n${serverLogs()}`,
    )

    const pdf = await client.request('GET', `/api/v1/sales-invoices/${invoiceId}/pdf`)
    const contentType = pdf.headers.get('content-type') ?? ''
    assert(
      pdf.status === 200,
      `PDF download returned ${String(pdf.status)}, not 200: ${problemSnippet(pdf.text)}\n${serverLogs()}`,
    )
    assert(
      contentType.startsWith('application/pdf'),
      `PDF content-type was ${contentType || '(missing)'}, not application/pdf`,
    )
    const magic = new TextDecoder().decode(pdf.bytes.subarray(0, 5))
    assert(magic === '%PDF-', `PDF body started with ${JSON.stringify(magic)}, not %PDF-`)

    const sent = await client.request('POST', `/api/v1/sales-invoices/${invoiceId}/send`, {})
    assert(
      sent.status === 200,
      `Invoice send returned ${String(sent.status)}: ${problemSnippet(sent.text)}\n${serverLogs()}`,
    )
    const sentBody = JSON.parse(sent.text) as { delivered?: boolean; failure?: string | null }
    assert(
      sentBody.delivered === true,
      `Invoice send did not deliver: ${sent.text.slice(0, 500)}\n${serverLogs()}`,
    )

    const message = invoiceMessage(buyer)
    assert(
      message !== undefined,
      `No outbox message to ${buyer} carried an attachment. The file transport is ${OUTBOX}.`,
    )
    const pdfLine = message
      .split('\n')
      .find((line) => line.startsWith('X-Klopt-Attachment:') && line.includes('.pdf'))
    assert(
      pdfLine !== undefined,
      `Outbox message to ${buyer} has no PDF attachment line.\n${message.split('\n').slice(0, 12).join('\n')}`,
    )
    assert(
      pdfLine.includes('(application/pdf)'),
      `PDF attachment was not application/pdf: ${pdfLine}`,
    )

    console.log(
      `prod-pdf: ${String(pdf.bytes.byteLength)} byte PDF from ${BASE} and a sent attachment in ${OUTBOX}`,
    )
  } finally {
    await stop(child)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
