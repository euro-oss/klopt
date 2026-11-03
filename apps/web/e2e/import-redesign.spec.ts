import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Import wizard v2 reskin (#134): six-step rail, XAF source, no horizontal
 * overflow at 390 in light and dark.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Redesign BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

test('the source step shows six steps and does not overflow at 390', async ({ page }) => {
  await anAdministration(page)
  await page.setViewportSize({ width: 390, height: 844 })

  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/importeren')
    await setTheme(page, theme)
    await expect(page.getByRole('heading', { name: 'Importeren', exact: true })).toBeVisible()
    const banner = page.getByRole('banner')
    await expect(banner.getByText('Importeren', { exact: true })).toBeVisible()
    await expect(banner.getByText('Moneybird', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    await expect(
      page
        .getByRole('paragraph')
        .filter({ hasText: /Stap 1 van 6:\s*Bron/ })
        .filter({ visible: true }),
    ).toBeVisible()
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await expect(page.getByRole('radio', { name: /Een ander pakket/ })).toBeVisible()
    await expect(page.getByText(/meeste Nederlandse pakketten/)).toBeVisible()
    await expect(page.getByText(/elk Nederlands pakket|every Dutch package/i)).toHaveCount(0)

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(fits, `${theme} overflows at 390`).toBe(true)
  }
})

test('XAF hides Next and ⌘↵ opens the audit file picker', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/importeren')
  const xaf = page.getByRole('radio', { name: /Een ander pakket/ })
  await expect(xaf).toBeEnabled({ timeout: 15_000 })
  await xaf.click()
  await expect(page).toHaveURL(/bron=xaf/)
  await expect(xaf).toBeChecked()
  await expect(page.locator('button[data-focus="next"]')).toHaveCount(0)
  await expect(page.getByText('auditfile openen', { exact: true })).toBeVisible()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.keyboard.press('ControlOrMeta+Enter')
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(false)

  await page.goto('/importeren')
  await expect(page.getByRole('radio', { name: /Een ander pakket/ })).toBeChecked()
})

test('a bookkeeper does not see the XAF source', async ({ browser }) => {
  const owner = await browser.newContext()
  const keeper = await browser.newContext()
  try {
    const ownerPage = await owner.newPage()
    await anAdministration(ownerPage)
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

    await keeperPage.goto('/importeren')
    await expect(keeperPage.getByText(/rol eigenaar of accountant nodig/)).toBeVisible({
      timeout: 15_000,
    })
    await expect(keeperPage.getByRole('radio', { name: /Moneybird/ })).toHaveCount(0)
  } finally {
    await owner.close()
    await keeper.close()
  }
})
