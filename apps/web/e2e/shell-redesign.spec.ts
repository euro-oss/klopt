import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  openAccountMenu,
  signIn,
  signOut,
  uniqueEmail,
} from './support'

/**
 * Redesign shell slice 2 (#61): nav IA, Geavanceerd, ⌘K.
 *
 * Screen content is out of scope; these specs only pin the chrome contracts
 * that Product signed off against the #57 prototype.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(
  page: Page,
  name: string,
  email: string = uniqueEmail(),
): Promise<string> {
  await page.goto('/sign-in')
  await signIn(page, email)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await hydrated(page)
  return email
}

test('daily-work groups come first in the rail', async ({ page }) => {
  await anAdministration(page, 'IA BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  // Exact headings: "Verkoop" is also a prefix of "Verkoopfacturen". Order is
  // document order — innerText of the rail drops groups that sit below the
  // scroll fold.
  const order = await nav.evaluate((root) =>
    [...root.querySelectorAll('p')].map((el) => el.textContent?.trim() ?? ''),
  )
  const expected = ['Verkoop', 'Inkoop', 'Geld', 'Boekhouden', 'Rapporten', 'Importeren', 'Beheer']
  let previous = -1
  for (const label of expected) {
    const at = order.indexOf(label)
    expect(at, label).toBeGreaterThan(previous)
    previous = at
  }

  await expect(nav.getByRole('link', { name: /^Koppelen/ })).toBeVisible()
})

test('Geavanceerd hides Journaalposten and Proefbalans from the nav', async ({ page }) => {
  await anAdministration(page, 'Eenvoud BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Categorieën/ })).toBeVisible()

  await enableAdvancedMode(page)

  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Grootboek/ })).toBeVisible()
})

test('⌘K still reaches Journaalposten when Geavanceerd is off', async ({ page }) => {
  await anAdministration(page, 'Palette BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /Geavanceerd aanzetten/ })).toBeVisible()

  await page.keyboard.type('journaal')
  await expect(palette.getByRole('option', { name: /Journaalposten/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
})

test('? opens keyboard help and mentions Geavanceerd is unbound', async ({ page }) => {
  await anAdministration(page, 'Help BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()
  await expect(help.getByText(/Geavanceerd heeft bewust geen sneltoets/)).toBeVisible()
})

test('turning Geavanceerd off from the menu hides the advanced nav again', async ({ page }) => {
  await anAdministration(page, 'Toggle BV')
  await enableAdvancedMode(page)

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()

  await openAccountMenu(page)
  await page.getByRole('switch', { name: /Geavanceerd/ }).click()
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.keyboard.press('Escape')

  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
})

test('a Boekhouder gets Geavanceerd on by default', async ({ browser }) => {
  const owner = await browser.newContext()
  const keeper = await browser.newContext()

  try {
    const ownerPage = await owner.newPage()
    await anAdministration(ownerPage, 'Boeken BV')

    const keeperPage = await keeper.newPage()
    const keeperEmail = uniqueEmail()
    await keeperPage.goto('/sign-in')
    await signIn(keeperPage, keeperEmail)
    await expect(keeperPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(keeperEmail)
    await chooseOption(ownerPage, 'Rol', 'Boekhouder', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByText(new RegExp(`${keeperEmail} heeft nu toegang`))).toBeVisible()

    await keeperPage.goto('/')
    await expect(keeperPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await hydrated(keeperPage)

    const nav = keeperPage.getByRole('navigation', { name: 'Hoofdnavigatie' })
    await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

    await openAccountMenu(keeperPage)
    await expect(keeperPage.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  } finally {
    await owner.close()
    await keeper.close()
  }
})

test('switching administration re-derives Geavanceerd from the active role', async ({
  browser,
}) => {
  // Eigenaar in A (off) and Boekhouder in B (on), with no explicit toggle yet.
  const ownerCtx = await browser.newContext()
  const peerCtx = await browser.newContext()

  try {
    const ownerPage = await ownerCtx.newPage()
    const ownerEmail = await anAdministration(ownerPage, 'Admin A')

    const peerPage = await peerCtx.newPage()
    await anAdministration(peerPage, 'Admin B')

    await peerPage.goto('/members')
    const invite = peerPage.locator('form', {
      has: peerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(ownerEmail)
    await chooseOption(peerPage, 'Rol', 'Boekhouder', invite)
    await peerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(peerPage.getByText(new RegExp(`${ownerEmail} heeft nu toegang`))).toBeVisible()

    // Pick up the new membership without a full sign-out.
    await ownerPage.goto('/')
    await expect(ownerPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await hydrated(ownerPage)

    const nav = ownerPage.getByRole('navigation', { name: 'Hoofdnavigatie' })
    await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)

    await chooseOption(ownerPage, 'Administratie', 'Admin B')
    await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

    await openAccountMenu(ownerPage)
    await expect(ownerPage.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  } finally {
    await ownerCtx.close()
    await peerCtx.close()
  }
})

test('Geavanceerd is isolated per user on the same browser', async ({ page }) => {
  await anAdministration(page, 'User X BV')
  await enableAdvancedMode(page)
  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()

  await signOut(page)
  await expect(page).toHaveURL(/\/sign-in$/)

  // Same browser context, different user — must see Eigenaar default (off),
  // not the previous account's explicit on.
  await anAdministration(page, 'User Y BV')
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await openAccountMenu(page)
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

test('Moneybird Geavanceerd checkbox shares the shell toggle', async ({ page }) => {
  await anAdministration(page, 'Moneybird Sync BV')

  await page.goto('/moneybird')
  await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()

  const moneybird = page.getByRole('checkbox', { name: /Geavanceerd|Advanced/ })
  await expect(moneybird).not.toBeChecked()

  await moneybird.check()
  await openAccountMenu(page)
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('switch', { name: /Geavanceerd/ }).click()
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.keyboard.press('Escape')

  await expect(moneybird).not.toBeChecked()
})

test('⌘K and the URL still reach Proefbalans when Geavanceerd is off', async ({ page }) => {
  await anAdministration(page, 'Proefbalans BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('proefbalans')
  await expect(palette.getByRole('option', { name: /Proefbalans/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Proefbalans' })).toBeVisible()

  await page.goto('/reports/trial-balance')
  await expect(page.getByRole('heading', { name: 'Proefbalans' })).toBeVisible()
})
