/**
 * Playwright `webServer` for CI: production bundle on loopback HTTP plus a
 * self-signed HTTPS front so Better Auth issues `Secure` session cookies.
 *
 * Started only via `playwright.ci.config.ts` (or with `KLOPT_E2E_BUILT_SERVER=1`
 * documented in e2e/README.md). Certificates are generated at runtime; nothing
 * is committed.
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_BUILT_HTTP_PORT, E2E_BUILT_HTTPS_ORIGIN, e2eBuiltWebServerEnv } from '../server-env.js'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER_ENTRY = join(WEB_ROOT, '.output', 'server', 'index.mjs')
const TLS_DIR = join(WEB_ROOT, 'e2e', '.ci-tls')
const HTTPS_PORT = Number(new URL(E2E_BUILT_HTTPS_ORIGIN).port || '443')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function ensureTlsMaterial(): { readonly key: Buffer; readonly cert: Buffer } {
  mkdirSync(TLS_DIR, { recursive: true })
  const keyPath = join(TLS_DIR, 'key.pem')
  const certPath = join(TLS_DIR, 'cert.pem')
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'inherit' },
    )
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  }
}

function proxyToApp(clientReq: IncomingMessage, clientRes: ServerResponse): void {
  const headers = { ...clientReq.headers }
  headers.host = `127.0.0.1:${String(E2E_BUILT_HTTP_PORT)}`

  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: E2E_BUILT_HTTP_PORT,
      path: clientReq.url,
      method: clientReq.method,
      headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(clientRes)
    },
  )

  upstream.on('error', (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    }
    clientRes.end(`upstream error: ${reason}`)
  })

  clientReq.pipe(upstream)
}

async function waitForHealth(): Promise<void> {
  const health = `http://127.0.0.1:${String(E2E_BUILT_HTTP_PORT)}/api/v1/health`
  const deadline = Date.now() + 120_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health, { redirect: 'manual' })
      if (response.ok) {
        console.log(`[built-server-webserver] ready at ${E2E_BUILT_HTTPS_ORIGIN}`)
        return
      }
      last = `health ${String(response.status)}`
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  fail(`HTTPS health check did not succeed: ${last}`)
}

function shutdownApp(child: ChildProcess): Promise<void> {
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

function closeHttps(httpsServer: HttpsServer): Promise<void> {
  return new Promise((resolve, reject) => {
    httpsServer.close((error) => {
      if (error !== undefined) reject(error)
      else resolve()
    })
  })
}

async function main(): Promise<void> {
  if (!existsSync(SERVER_ENTRY)) {
    fail(
      `Missing ${SERVER_ENTRY}. Run pnpm run build (or pnpm --filter @klopt/web run build) before built-server e2e.`,
    )
  }

  const { key, cert } = ensureTlsMaterial()
  const serverEnv = e2eBuiltWebServerEnv(process.env)

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: WEB_ROOT,
    env: { ...process.env, ...serverEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))

  let shuttingDown = false
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (code !== null && code !== 0) {
      fail(`Built server exited with code ${String(code)}`)
    }
    if (signal !== null) {
      fail(`Built server exited on signal ${signal}`)
    }
  })

  const httpsServer = createHttpsServer({ key, cert }, proxyToApp)

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    shuttingDown = true
    console.log(`[built-server-webserver] stopping (${signal})`)
    await closeHttps(httpsServer).catch(() => undefined)
    await shutdownApp(child)
    process.exit(0)
  }

  process.once('SIGINT', () => {
    void stop('SIGINT')
  })
  process.once('SIGTERM', () => {
    void stop('SIGTERM')
  })

  await new Promise<void>((resolve, reject) => {
    httpsServer.once('error', reject)
    httpsServer.listen(HTTPS_PORT, '127.0.0.1', () => resolve())
  })

  await waitForHealth()
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
