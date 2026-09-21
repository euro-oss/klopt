import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

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

/**
 * Resolves once React has taken over the page.
 *
 * Every screen in the shell renders server-side first, and until hydration a
 * button is a button that does nothing: a click is swallowed, a keystroke is
 * lost, and the assertion afterwards fails somewhere else entirely — which is
 * the most expensive kind of flake to read. Several specs already wait for a
 * control that is `disabled` until hydration; this is the same wait for the
 * screens that have no such control.
 *
 * The signal is the sidebar's shortcut hints, which the shell prints only
 * once the keys work. That is deliberate (see `AppShell`), and it makes the
 * hint the one honest, screen-independent "the page is live now".
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: /Journaalposten/ }).locator('kbd')).toHaveCount(1)
}

/** Take a brand-new address all the way to a signed-in session. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Stuur me een code' }).click()

  await expect(page.getByLabel('Code')).toBeVisible()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Aanmelden' }).click()
}

/**
 * Open the account menu at the bottom of the sidebar.
 *
 * Language, appearance and sign-out used to be printed against the bottom of
 * the rail and could be clicked where they stood. They now live one click in,
 * behind the `[H] Hidde ›` row, so every spec that touches one opens this
 * first. Idempotent, because a spec that changes two settings in a row finds
 * the menu already open — Radix keeps it open through the re-render.
 *
 * The section is labelled in the reader's language, hence the alternation: the
 * language spec switches to English halfway through and then comes back here.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const trigger = page.getByRole('region', { name: /^(Profiel|Profile)$/ }).getByRole('button')

  if ((await trigger.getAttribute('aria-expanded')) === 'true') return

  // Disabled until React attaches: the menu is a Radix popover, so before
  // hydration the row is a button that opens nothing.
  await expect(trigger).toBeEnabled()
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * Choose an option from a shadcn/Radix select.
 *
 * `selectOption` only drives a real `<select>`, and these are a button and a
 * portalled listbox. Two clicks — and the second one is always looked up on
 * the page, never inside `within`, because the listbox is rendered in a portal
 * at the end of `<body>` rather than where the trigger sits.
 *
 * `option` matches the visible text, so pass a RegExp where the test used to
 * pass a value: `selectOption('4400')` becomes `/^4400 /`.
 */
export async function chooseOption(
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
  within?: Locator,
): Promise<void> {
  await (within ?? page).getByLabel(label).click()
  await page.getByRole('option', { name: option }).click()

  // The listbox animates out. Waiting for it to go means the next interaction
  // cannot land on an overlay that is still swallowing clicks.
  await expect(page.getByRole('listbox')).toBeHidden()
}

/**
 * Change a preference that lives in the account menu, and put the menu away.
 *
 * The closing is not tidiness. The panel opens upward over the bottom of the
 * navigation, so a spec that changed the language and then clicked a nav link
 * would be clicking at an overlay — the "element intercepts pointer events"
 * flake, arriving a screen later than its cause.
 */
export async function chooseInAccountMenu(
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  await openAccountMenu(page)
  await chooseOption(page, label, option)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
}
