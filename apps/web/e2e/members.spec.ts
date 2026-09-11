import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * Handing out access, in a browser.
 *
 * The parts worth exercising here rather than against the handlers: the nav
 * entry only exists for an owner, the list mixes members and invitations, and
 * refusing to remove the last owner surfaces as a message rather than as
 * nothing happening.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

/** Sign in as a new user and provision an administration to own. */
async function anOwner(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('an owner invites somebody, sees them waiting, and withdraws it', async ({ page }) => {
  await anOwner(page, 'Toegang Test BV')
  const invitee = uniqueEmail()

  // The nav entry exists at all only because this session is an owner.
  await page.getByRole('link', { name: /Toegang/ }).click()
  await expect(page.getByRole('heading', { name: 'Toegang' })).toBeVisible()

  // Scoped to the invite form: every member row has a role select too, and
  // that ambiguity is the screen working as intended.
  const invite = page.locator('form', { has: page.getByRole('button', { name: 'Uitnodigen' }) })
  await invite.getByLabel('E-mail').fill(invitee)
  await chooseOption(page, 'Rol', 'Accountant', invite)
  await page.getByRole('button', { name: 'Uitnodigen' }).click()

  // Listed as waiting, not as a member, and the screen says so in words. The
  // cell specifically: the confirmation message names the address too, and
  // matching on the address alone is a race between the two.
  await expect(page.getByRole('cell', { name: invitee })).toBeVisible()
  await expect(page.getByText(/uitgenodigd, nog niet aangemeld/)).toBeVisible()

  await page.getByRole('button', { name: 'Intrekken' }).click()

  await expect(page.getByText(/is ingetrokken/)).toBeVisible()
  // The row is gone. Asserting on the address alone would pass on the
  // confirmation message, which names it.
  await expect(page.getByRole('button', { name: 'Intrekken' })).toHaveCount(0)
})

test('removing the last owner is refused out loud', async ({ page }) => {
  await anOwner(page, 'Laatste Eigenaar BV')

  await page.goto('/members')
  await page.getByRole('button', { name: 'Verwijderen' }).click()

  await expect(page.getByRole('alert')).toContainText('last owner')
  // Still there. The failure mode this guards against is the row quietly going.
  await expect(page.getByRole('button', { name: 'Verwijderen' })).toBeVisible()
})
