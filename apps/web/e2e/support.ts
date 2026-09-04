import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

/**
 * Shared plumbing for the browser tests: a fresh address, the code that was
 * delivered to it, and the two-step sign-in that turns one into a session.
 */

export const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/** Where the file email transport drops messages. See playwright.config.ts. */
export const OUTBOX = join(import.meta.dirname, '.outbox')

export function uniqueEmail(): string {
  return `e2e-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

/**
 * Read the code out of the delivered message.
 *
 * Not out of the database: the codes are hashed there deliberately, so that a
 * dump contains nothing usable. The transport is the only honest place to
 * observe one, which is also true of a real mailbox.
 */
export async function codeFor(email: string): Promise<string> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    // The directory may not exist yet: nothing has been delivered.
    const files = existsSync(OUTBOX)
      ? readdirSync(OUTBOX).filter((name) => name.endsWith('.txt'))
      : []

    for (const name of files.sort().reverse()) {
      const message = readFileSync(join(OUTBOX, name), 'utf8')
      if (!message.includes(`To: ${email}`)) continue
      const match = /^\s{4}(\d{6})\s*$/m.exec(message)
      if (match?.[1] !== undefined) return match[1]
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`No sign-in code was delivered to ${email}.`)
}

/** Take a brand-new address all the way to a signed-in session. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Stuur me een code' }).click()

  await expect(page.getByLabel('Code')).toBeVisible()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Aanmelden' }).click()
}
