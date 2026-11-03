import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Phone contact card (#130): `/contacts/$id` matches PhoneContactCard boards at
 * 390 light and dark; edit opens with `?edit=1`.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Relaties Phone Kaart BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedCustomer(page: Page): Promise<string> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1302')
  await page.getByLabel('Naam', { exact: true }).fill('Zandbank Advies')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Zandbank Advies/ })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('id')
  expect(id).toBeTruthy()
  return id!
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.context().addCookies([
    {
      name: 'klopt_theme',
      value: theme,
      domain: 'localhost',
      path: '/',
    },
  ])
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await persistThemeCookie(page, theme)
  await page.evaluate((t) => {
    document.cookie = `klopt_theme=${t}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
}

test('phone contact card at 390 light and dark; edit via Bewerken', async ({ page }) => {
  await openAdmin(page)
  const id = await seedCustomer(page)

  for (const theme of ['light', 'dark'] as const) {
    await persistThemeCookie(page, theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${id}`)
    await setTheme(page, theme)
    await expect(page.locator('[data-phone-tab-bar]')).toBeVisible()

    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('link', { name: '‹ Relaties' })).toBeVisible()
    await expect(card.getByRole('link', { name: 'Bewerken' })).toBeVisible()
    await expect(card.getByRole('link', { name: 'Nieuwe factuur' })).toBeVisible()
    await expect(card.getByRole('region', { name: 'Contactgegevens' })).toBeVisible()
    await expect(card).toContainText('Zandbank Advies')
    await expect(card).toContainText('Amsterdam')
    await expect(card).toContainText('DEB-1302')
    await expect(card).not.toContainText(/gekoppeld/i)

    await card.getByRole('link', { name: 'Bewerken' }).click()
    await expect(page).toHaveURL(new RegExp(`/contacts/${id}[?]edit=`))
    await expect(page.getByRole('button', { name: 'Opslaan' })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeHidden()
  }
})

test('phone list opens the card route, not the edit form', async ({ page }) => {
  await openAdmin(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/contacts')
  await page.getByRole('button', { name: '+ Relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1303')
  await page.getByLabel('Naam', { exact: true }).fill('Windvaan Workshops (demo)')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await page.getByRole('button', { name: /Windvaan Workshops \(demo\)/ }).click()
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/)
  await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeVisible()
  await expect(page.getByLabel('Naam', { exact: true })).toBeHidden()
})

async function assertPhoneCardPrivacyHidden(page: Page, contactId: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await persistThemeCookie(page, theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${contactId}`)
    await page.reload()
    await page.waitForFunction(() => window.matchMedia('(max-width: 767px)').matches)
    await setTheme(page, theme)
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('region', { name: 'Contactgegevens' })).toBeVisible()
    await expect(card.getByText('Privacyverzoek')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Persoonsgegevens wissen' })).toHaveCount(0)
  }
}

async function assertPhoneCardPrivacyVisible(page: Page, contactId: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await persistThemeCookie(page, theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${contactId}`)
    await page.reload()
    await page.waitForFunction(() => window.matchMedia('(max-width: 767px)').matches)
    await setTheme(page, theme)
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('region', { name: 'Contactgegevens' })).toBeVisible()
    await expect(card.getByRole('region', { name: 'Privacyverzoek' })).toBeVisible({
      timeout: 60_000,
    })
    await expect(card.getByRole('button', { name: 'Persoonsgegevens wissen' })).toBeVisible()
  }
}

async function inviteMember(
  ownerPage: Page,
  memberEmail: string,
  role: 'Accountant' | 'Boekhouder',
): Promise<void> {
  await ownerPage.goto('/members')
  const invite = ownerPage.locator('form', {
    has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
  })
  await invite.getByLabel('E-mail').fill(memberEmail)
  await chooseOption(ownerPage, 'Rol', role, invite)
  await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
  await expect(ownerPage.getByText(new RegExp(`${memberEmail} heeft nu toegang`))).toBeVisible()
}

test('phone card privacy erase hidden for Accountant at 390 light and dark', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ownerCtx = await browser.newContext()
  const memberCtx = await browser.newContext()

  try {
    const ownerPage = await ownerCtx.newPage()
    await openAdmin(ownerPage)
    const contactId = await seedCustomer(ownerPage)

    const memberPage = await memberCtx.newPage()
    const memberEmail = uniqueEmail()
    await memberPage.goto('/sign-in')
    await signIn(memberPage, memberEmail)
    await expect(memberPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
    await inviteMember(ownerPage, memberEmail, 'Accountant')
    await memberPage.goto('/')
    await expect(
      memberPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await assertPhoneCardPrivacyHidden(memberPage, contactId)
  } finally {
    await ownerCtx.close()
    await memberCtx.close()
  }
})

test('phone card privacy erase hidden for Boekhouder at 390 light and dark', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const ownerCtx = await browser.newContext()
  const memberCtx = await browser.newContext()

  try {
    const ownerPage = await ownerCtx.newPage()
    await openAdmin(ownerPage)
    const contactId = await seedCustomer(ownerPage)

    const memberPage = await memberCtx.newPage()
    const memberEmail = uniqueEmail()
    await memberPage.goto('/sign-in')
    await signIn(memberPage, memberEmail)
    await expect(memberPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
    await inviteMember(ownerPage, memberEmail, 'Boekhouder')
    await memberPage.goto('/')
    await expect(
      memberPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await assertPhoneCardPrivacyHidden(memberPage, contactId)
  } finally {
    await ownerCtx.close()
    await memberCtx.close()
  }
})

test('phone card privacy erase visible for owner at 390 (positive control)', async ({ page }) => {
  await openAdmin(page)
  const contactId = await seedCustomer(page)
  await assertPhoneCardPrivacyVisible(page, contactId)
})
