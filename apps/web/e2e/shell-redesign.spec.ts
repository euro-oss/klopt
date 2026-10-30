import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  advancedModeSwitch,
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  openAccountMenu,
  setAdvancedMode,
  signIn,
  signOut,
  uniqueEmail,
} from './support'

/**
 * Redesign shell Phase 0 (#107): v2 grouped IA, boekhouddetails, ⌘K, PhoneTabBar.
 *
 * Screen content (phases 1–15) is out of scope; these specs pin the chrome.
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
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
  return email
}

test('v2 rail: Home, Inbox, Money, Books; footer Import + Settings + Shortcuts', async ({
  page,
}) => {
  await anAdministration(page, 'IA BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  const labels = await nav.evaluate((root) =>
    [...root.querySelectorAll('a, button')].map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  )
  const expected = [
    'Home',
    'Postvak',
    'Verkoop',
    'Kosten',
    'Bank',
    'Relaties',
    'Journaal',
    'BTW',
    'Rapporten',
    'Importeren',
    'Instellingen',
    'Sneltoetsen',
  ]
  let previous = -1
  for (const label of expected) {
    const at = labels.findIndex((text) => text.startsWith(label))
    expect(at, label).toBeGreaterThan(previous)
    previous = at
  }
  // Categories / Ledger [API] stay out of the rail.
  expect(labels.some((text) => text.includes('Categorieën'))).toBe(false)
  expect(labels.some((text) => text === 'Grootboek' || text.startsWith('Grootboek '))).toBe(false)
})

test('Reports tabs always include Proefbalans as 5; no Journaalposten tab', async ({ page }) => {
  await anAdministration(page, 'Eenvoud BV')

  await page.goto('/reports/profit-and-loss')
  const tabs = page.locator('[data-reports-tabs]')
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)

  await page.goto('/entries')
  const journal = page.locator('[data-journal-tabs]')
  await expect(journal.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
  await expect(journal.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(journal.getByRole('link', { name: /Grootboek/ })).toHaveCount(0)
})

test('⌘K reaches Journaal when boekhouddetails is off', async ({ page }) => {
  await anAdministration(page, 'Palette BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  // Toggle lives on Settings now — not a ⌘K action.
  await expect(
    palette.getByRole('option', { name: /Geavanceerd|Boekhouddetails|advanced/i }),
  ).toHaveCount(0)

  await page.keyboard.type('journaal')
  await expect(palette.getByRole('option', { name: /^Journaal/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
})

test('⌘K does not list categories (Categorieën) — [API]', async ({ page }) => {
  await anAdministration(page, 'No Categories BV')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('categorie')
  await expect(palette.getByRole('option', { name: /Categorieën/ })).toHaveCount(0)
})

test('PhoneTabBar More opens the existing Sheet at 390', async ({ page }) => {
  await anAdministration(page, 'Phone More BV')
  await page.setViewportSize({ width: 390, height: 844 })
  const bar = page.locator('[data-phone-tab-bar]')
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Meer' }).click()
  await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Journaal/ })).toBeVisible()
})

test('? opens keyboard help and mentions boekhouddetails is unbound', async ({ page }) => {
  await anAdministration(page, 'Help BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()
  await expect(
    help.getByText(
      /Boekhouddetails heeft bewust geen sneltoets|Geavanceerd heeft bewust geen sneltoets/,
    ),
  ).toBeVisible()
  await expect(help.getByRole('heading', { name: 'Tabbladen' })).toBeVisible()
  await expect(help.getByText(/Tabs wisselen/)).toBeVisible()
  await expect(help.getByText('1–5')).toBeVisible()
})

test('help Nieuw always lists Nieuwe journaalpost', async ({ page }) => {
  await anAdministration(page, 'Help Nieuw BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  // `exact: true` — otherwise "Nieuw" also matches the "Nieuwe factuur" group.
  const nieuw = help
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Nieuw', exact: true }) })
  await expect(nieuw.getByRole('heading', { name: 'Nieuw', exact: true })).toBeVisible()
  // Designer: nav / ⌘K / help must not gate on boekhouddetails.
  await expect(nieuw.getByText('Nieuwe journaalpost')).toBeVisible()
  await expect(nieuw.getByText('Nieuwe factuur', { exact: true })).toBeVisible()
})

test('⌘K and n j always reach Nieuwe journaalpost', async ({ page }) => {
  await anAdministration(page, 'Palette Nieuw BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('nieuwe journaal')
  await expect(palette.getByRole('option', { name: /Nieuwe journaalpost/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.keyboard.press('n')
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/\/entries\/new/)
})

test('a failed boekhouddetails save reverts the switch and shows the toast', async ({ page }) => {
  await anAdministration(page, 'Save Fail BV')

  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
      await route.fulfill({ status: 500, body: 'save failed' })
      return
    }
    await route.continue()
  })

  await page.goto('/settings')
  await hydrated(page)
  const toggle = advancedModeSwitch(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()

  // Optimistic flip reverts once the 500 lands.
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const toast = page.getByTestId('advanced-mode-save-failed')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(
    /Geavanceerd is niet opgeslagen|Boekhouddetails.*(niet opgeslagen|niet bewaard)|wasn't saved|not saved/i,
  )
  await expect(toast.getByRole('button', { name: 'Sluiten' })).toBeVisible()
  // Exactly one live region — the toast, not a second inline alert.
  await expect(page.getByRole('alert')).toHaveCount(1)
})

test('double-click while boekhouddetails save is in flight issues one POST', async ({ page }) => {
  await anAdministration(page, 'Double Toggle BV')

  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let posts = 0
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
      posts += 1
      await held
      await route.continue()
      return
    }
    await route.continue()
  })

  await page.goto('/settings')
  await hydrated(page)
  const toggle = advancedModeSwitch(page)
  await toggle.focus()
  await expect(toggle).toBeFocused()

  await toggle.click()
  // In-flight: busy. Settings dims via disabled while saving (unlike the old
  // account-menu switch); second interaction must not enqueue another POST.
  await expect(toggle).toHaveAttribute('aria-busy', 'true')
  await expect(page).toHaveURL(/\/settings/)

  await toggle.click({ force: true }).catch(() => undefined)
  release()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).not.toHaveAttribute('aria-busy')
  expect(posts).toBe(1)
})

test('help Ga naar lists Journal and omits categories', async ({ page }) => {
  await anAdministration(page, 'Help Volgorde BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  const goTo = help
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Ga naar' }) })
  await expect(goTo.getByRole('heading', { name: 'Ga naar' })).toBeVisible()

  const labels = await goTo.locator('dt').allTextContents()
  const trimmed = labels.map((label) => label.trim())
  expect(trimmed.indexOf('Home')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Journaal')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Rapporten')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Proefbalans')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Categorieën')).toBe(-1)
  expect(trimmed.indexOf('Grootboekrekeningen')).toBe(-1)
  // ⌘K is two chips; letter capital after the modifier.
  const paletteChips = await help.evaluate((root) => {
    const dt = [...root.querySelectorAll('dt')].find(
      (el) => el.textContent?.trim() === 'Commandopalet',
    )
    return [...(dt?.parentElement?.querySelectorAll('kbd') ?? [])].map(
      (kbd) => kbd.textContent ?? '',
    )
  })
  expect(paletteChips).toEqual(['Ctrl', 'K'])
})

test('Reports Proefbalans stays visible when boekhouddetails is off', async ({ page }) => {
  await anAdministration(page, 'Toggle BV')
  await enableAdvancedMode(page)

  await page.goto('/reports/profit-and-loss')
  const tabs = page.locator('[data-reports-tabs]')
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

  await setAdvancedMode(page, false)
  await page.goto('/reports/profit-and-loss')
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
})

test('a Boekhouder gets boekhouddetails on by default', async ({ browser }) => {
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
    await expect(
      keeperPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await hydrated(keeperPage)

    await keeperPage.goto('/reports/profit-and-loss')
    const tabs = keeperPage.locator('[data-reports-tabs]')
    await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

    await keeperPage.goto('/settings')
    await expect(advancedModeSwitch(keeperPage)).toHaveAttribute('aria-checked', 'true')
  } finally {
    await owner.close()
    await keeper.close()
  }
})

test('switching administration re-derives boekhouddetails from the active role', async ({
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
    await expect(
      ownerPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await hydrated(ownerPage)

    await ownerPage.goto('/reports/profit-and-loss')
    const tabs = ownerPage.locator('[data-reports-tabs]')
    await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

    await ownerPage.goto('/settings')
    await expect(advancedModeSwitch(ownerPage)).toHaveAttribute('aria-checked', 'false')
    await expect(ownerPage.getByRole('region', { name: 'Profiel' })).toContainText(/Eigenaar/)
    await expect(ownerPage.getByRole('region', { name: 'Profiel' })).not.toContainText(
      /Geavanceerd/,
    )

    await chooseOption(ownerPage, 'Administratie', 'Admin B')
    await ownerPage.goto('/reports/profit-and-loss')
    await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

    await ownerPage.goto('/settings')
    await expect(advancedModeSwitch(ownerPage)).toHaveAttribute('aria-checked', 'true')
  } finally {
    await ownerCtx.close()
    await peerCtx.close()
  }
})

test('boekhouddetails is isolated per user on the same browser', async ({ page }) => {
  await anAdministration(page, 'User X BV')
  await enableAdvancedMode(page)
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')

  await signOut(page)
  await expect(page).toHaveURL(/\/sign-in$/)

  // Same browser context, different user — must see Eigenaar default (off),
  // not the previous account's explicit on.
  await anAdministration(page, 'User Y BV')
  await page.goto('/settings')
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'false')
})

test('Importeren Geavanceerd checkbox shares the Settings toggle', async ({ page }) => {
  await anAdministration(page, 'Moneybird Sync BV')

  await page.goto('/importeren?bron=moneybird')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  // Full navigation remounts the tree; click before hydration toggles the DOM
  // without React onChange, so the shell switch stays off.
  await hydrated(page)

  const wizard = page.getByRole('checkbox', { name: /Geavanceerd|Advanced/ })
  await expect(wizard).not.toBeChecked()

  await wizard.check()
  await page.goto('/settings')
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')

  await setAdvancedMode(page, false)

  await page.goto('/importeren?bron=moneybird')
  await hydrated(page)
  await expect(page.getByRole('checkbox', { name: /Geavanceerd|Advanced/ })).not.toBeChecked()
})

test('⌘K and the URL still reach Proefbalans when boekhouddetails is off', async ({ page }) => {
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

test('boekhouddetails choice persists across a fresh browser context for the same user', async ({
  browser,
}) => {
  const email = uniqueEmail()
  const first = await browser.newContext()

  try {
    const page = await first.newPage()
    await anAdministration(page, 'Persist BV', email)
    await enableAdvancedMode(page)

    await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')

    // Reload once so we know the server write landed before we throw the
    // cookie jar away — the next context has no cookies of its own.
    await page.reload()
    await hydrated(page)
    await page.goto('/settings')
    await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')
  } finally {
    await first.close()
  }

  const second = await browser.newContext()
  try {
    const page = await second.newPage()
    await page.goto('/sign-in')
    await signIn(page, email)
    await expect(
      page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await hydrated(page)

    await page.goto('/reports/profit-and-loss')
    await expect(
      page.locator('[data-reports-tabs]').getByRole('link', { name: /Proefbalans/ }),
    ).toBeVisible()
    await page.goto('/settings')
    await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')
  } finally {
    await second.close()
  }
})

test('n c opens Relaties and n r opens inkoop nieuw', async ({ page }) => {
  await anAdministration(page, 'Nieuw Chord BV')

  await page.keyboard.press('n')
  await page.keyboard.press('c')
  await expect(page).toHaveURL(/\/contacts/)
  await expect(page.getByRole('heading', { name: /Relaties/ })).toBeVisible()

  await page.keyboard.press('n')
  await page.keyboard.press('r')
  await expect(page).toHaveURL(/\/purchases\/new/)
})

test('digit keys switch Reports tabs 1–5', async ({ page }) => {
  await anAdministration(page, 'Tabs BV')
  await page.goto('/reports/profit-and-loss')
  await hydrated(page)

  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/reports\/trial-balance/)
  await expect(page.getByRole('heading', { name: 'Proefbalans' })).toBeVisible()

  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/reports\/profit-and-loss/)
})

test('digit keys switch Journal tabs Entries / Trial', async ({ page }) => {
  await anAdministration(page, 'Journal Tabs BV')
  await page.goto('/entries')
  await hydrated(page)

  await page.keyboard.press('2')
  await expect(page).toHaveURL(/\/reports\/trial-balance/)
  await expect(page.getByRole('heading', { name: 'Proefbalans' })).toBeVisible()

  await page.goto('/entries')
  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/entries/)
})

test('g j opens Journal', async ({ page }) => {
  await anAdministration(page, 'Go Journal BV')
  await page.keyboard.press('g')
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/\/entries/)
  await expect(page.locator('[data-journal-tabs]')).toBeVisible()
})

test('Settings hub lists Overstappen naar Klopt', async ({ page }) => {
  await anAdministration(page, 'Settings Hub BV')
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Overstappen naar Klopt' })).toBeVisible()
  await expect(advancedModeSwitch(page)).toBeVisible()
  await page.getByRole('link', { name: /Vanuit Moneybird/ }).click()
  await expect(page).toHaveURL(/\/importeren/)
})

test('⌘K Importeren action reaches the wizard', async ({ page }) => {
  await anAdministration(page, 'Import Palette BV')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('importeren')
  await expect(palette.getByRole('option', { name: /^Importeren/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/importeren/)
})

test('account menu profile line shows role only', async ({ page }) => {
  await anAdministration(page, 'Role Only BV')
  const profile = page.getByRole('region', { name: 'Profiel' })
  await expect(profile).toContainText(/Eigenaar/)
  await expect(profile).not.toContainText(/Geavanceerd/)
  await openAccountMenu(page)
  const panel = page.getByRole('dialog', { name: 'Profiel' })
  await expect(panel).toContainText(/Eigenaar/)
  await expect(panel).not.toContainText(/Geavanceerd/)
  await expect(panel.getByRole('switch')).toHaveCount(0)
})
