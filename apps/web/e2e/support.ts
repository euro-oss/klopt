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
 *
 * Waits on Dashboard rather than Journaalposten: Eigenaar has Geavanceerd off
 * by default (#44), so journal entries are absent from the nav until the toggle
 * is on — but they stay reachable via ⌘K and `g j`.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('link', { name: /^Dashboard/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
}

/**
 * True when this response is the Geavanceerd save POST finishing.
 *
 * TanStack Start serialises the payload; matching on `enabled` keeps us from
 * racing an unrelated POST (language, theme, entity switch).
 */
function isAdvancedModeSaveResponse(response: {
  request: () => { method: () => string; postData: () => string | null }
  ok: () => boolean
}): boolean {
  if (response.request().method() !== 'POST') return false
  const body = response.request().postData() ?? ''
  return body.includes('enabled') && response.ok()
}

/**
 * Flip Geavanceerd to the given value from the account menu.
 *
 * Always waits for the save POST response before returning, so a later reload
 * or fresh context sees the stored choice rather than the role default.
 */
export async function setAdvancedMode(page: Page, enabled: boolean): Promise<void> {
  // Phone: the profile row lives inside the Sheet, so open that first.
  const openMenu = page.getByRole('button', { name: /Menu openen|Open menu/ })
  if (await openMenu.isVisible().catch(() => false)) {
    await expect(openMenu).toBeEnabled()
    if ((await openMenu.getAttribute('aria-expanded')) !== 'true') {
      await openMenu.click()
    }
  }

  await openAccountMenu(page)
  const toggle = page.getByRole('switch', { name: /Geavanceerd|Advanced/ })
  const want = enabled ? 'true' : 'false'
  if ((await toggle.getAttribute('aria-checked')) !== want) {
    const persisted = page.waitForResponse(isAdvancedModeSaveResponse, { timeout: 15_000 })
    await toggle.click()
    await persisted
  }
  await expect(toggle).toHaveAttribute('aria-checked', want)
  await page.keyboard.press('Escape')
}

/** Turn Geavanceerd on from the account menu (owner default is off). */
export async function enableAdvancedMode(page: Page): Promise<void> {
  await setAdvancedMode(page, true)
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
  // On the phone the profile sits in the Sheet; prefer the last (visible) one.
  const trigger = page
    .getByRole('region', { name: /^(Profiel|Profile)$/ })
    .getByRole('button')
    .last()

  if ((await trigger.getAttribute('aria-expanded')) === 'true') return

  // Disabled until React attaches: the menu is a Radix popover, so before
  // hydration the row is a button that opens nothing.
  await expect(trigger).toBeEnabled()
  await trigger.click()
  // The Sheet is also a dialog — pin the account menu by the Geavanceerd switch.
  await expect(page.getByRole('switch', { name: /Geavanceerd|Advanced/ })).toBeVisible()
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
/**
 * Open the combined Administratie / Boekjaar switcher (#57 / #64).
 *
 * The labelled selects live inside the popover; e2e that still names
 * `Administratie` or `Boekjaar` opens this first.
 */
export async function openEntitySwitcher(page: Page): Promise<void> {
  const trigger = page.getByRole('button', {
    name: /Administratie en boekjaar|Administration and book year/,
  })
  await expect(trigger).toBeEnabled()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
  // Comboboxes, not the trigger's aria-label (which also contains "boekjaar").
  await expect(
    page.getByRole('combobox', { name: /^(Administratie|Administration)$/ }),
  ).toBeVisible()
}

export async function chooseOption(
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
  within?: Locator,
): Promise<void> {
  const shellLabel =
    typeof label === 'string' && /^(Administratie|Boekjaar|Administration|Book year)$/.test(label)
  if (shellLabel) {
    // exact: fiscal-years page also has "Boekjaar om af te sluiten".
    const field = (within ?? page).getByRole('combobox', { name: label, exact: true })
    if (!(await field.isVisible().catch(() => false))) {
      await openEntitySwitcher(page)
    }
    await field.click()
  } else {
    await (within ?? page).getByLabel(label).click()
  }
  await page.getByRole('option', { name: option }).click()

  // The listbox animates out. Waiting for it to go means the next interaction
  // cannot land on an overlay that is still swallowing clicks.
  await expect(page.getByRole('listbox')).toBeHidden()
}

/** Sign out from the shell, which is now one click inside the account menu. */
export async function signOut(page: Page): Promise<void> {
  await openAccountMenu(page)
  await page.getByRole('button', { name: 'Uitloggen' }).click()
}

/**
 * Change a preference that lives in the account menu, and put the menu away.
 *
 * The closing is not tidiness. The panel opens upward over the bottom of the
 * navigation, so a spec that changed the language and then clicked a nav link
 * would be clicking at an overlay — the "element intercepts pointer events"
 * flake, arriving a screen later than its cause.
 *
 * The preferences are short button rows (NL|EN, Licht|Donker|Systeem), not
 * SelectFields, so this clicks a pressed-style button inside the labelled
 * group rather than opening a listbox.
 */
export async function chooseInAccountMenu(
  page: Page,
  label: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  await openAccountMenu(page)
  await page.getByRole('group', { name: label }).getByRole('button', { name: option }).click()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('switch', { name: /Geavanceerd|Advanced/ })).toBeHidden()
}
