import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closeDatabase, createDatabase, membershipsFor, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * From nothing to a working set of books, in a browser.
 *
 * The journey a self-hoster actually takes on day one, and the one that used to
 * end in a screen with nothing on it but a sign-out button. It belongs here
 * rather than in a handler test for the usual reason: its failure mode is "the
 * screen did not change".
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

test('a new user signs in, sets up an administration and lands in it', async ({ page }) => {
  const email = uniqueEmail()
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  try {
    await page.goto('/sign-in')
    await signIn(page, email)

    await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
    await page.getByRole('link', { name: 'Administratie opzetten' }).click()

    await expect(page).toHaveURL(/\/setup$/)
    await expect(page.getByRole('heading', { name: 'Nieuwe administratie' })).toBeVisible()

    // The chart is reference data, and the screen says what provisioning it
    // will actually produce rather than leaving it to be discovered.
    await expect(page.getByText(/grootboekrekeningen/)).toBeVisible()

    await page.getByLabel('Naam van de administratie').fill('Speelgoedwinkel De Tol')
    await page.getByLabel('KvK-nummer').fill('12345678')
    await page.getByRole('button', { name: 'Administratie aanmaken' }).click()

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    // The picker is on the new administration, not on whichever one sorts
    // first: the session was pointed at it as part of creating it.
    await expect(
      page.getByRole('combobox', { name: /Administratie/ }).locator('option:checked'),
    ).toHaveText('Speelgoedwinkel De Tol')
    await expect(page.getByText('rol: owner')).toBeVisible()

    const userId = await findUserIdByEmail(database, email)
    if (userId === null) throw new Error('The sign-in did not create a user.')
    expect(await membershipsFor(database, userId)).toEqual([
      { entityId: expect.any(String), entityName: 'Speelgoedwinkel De Tol', role: 'owner' },
    ])

    // The books are usable, not merely present: the chart of accounts is there.
    await page.goto('/accounts')
    await expect(page.getByRole('heading', { name: 'Grootboek' })).toBeVisible()
    await expect(page.getByText('Debiteuren').first()).toBeVisible()
  } finally {
    await closeDatabase(database)
  }
})

test('a bad KvK number is reported on the field, not swallowed', async ({ page }) => {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  // Wait for the session to land before navigating, or the guard on /setup
  // sees no cookie and bounces straight back to the form.
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.goto('/setup')
  await page.getByLabel('Naam van de administratie').fill('Foutje BV')
  await page.getByLabel('KvK-nummer').fill('123')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()

  // On the field itself, next to the input that is wrong.
  await expect(page.getByText('A KvK number is eight digits.')).toBeVisible()
  await expect(page).toHaveURL(/\/setup$/)
})
