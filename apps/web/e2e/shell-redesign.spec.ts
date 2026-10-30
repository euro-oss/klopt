import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
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
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
  return email
}

test('flat rail lists the eight export destinations then Settings', async ({ page }) => {
  await anAdministration(page, 'IA BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  const labels = await nav.evaluate((root) =>
    [...root.querySelectorAll('a, button')].map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  )
  const expected = ['Home', 'Postvak', 'Verkoop', 'Kosten', 'Bank', 'BTW', 'Rapporten', 'Relaties']
  let previous = -1
  for (const label of expected) {
    const at = labels.findIndex((text) => text.startsWith(label))
    expect(at, label).toBeGreaterThan(previous)
    previous = at
  }
  expect(labels.some((text) => text.startsWith('Instellingen'))).toBe(true)
  expect(labels.some((text) => text.startsWith('Sneltoetsen'))).toBe(true)
  // Importeren / journal / trial stay out of the flat rail.
  expect(labels.some((text) => text.includes('Journaalposten'))).toBe(false)
  expect(labels.some((text) => text.includes('Proefbalans'))).toBe(false)
  expect(labels.some((text) => text.includes('Importeren'))).toBe(false)
})

test('Geavanceerd shows Proefbalans and Journaalposten on Reports tabs only', async ({ page }) => {
  await anAdministration(page, 'Eenvoud BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)

  await page.goto('/reports/profit-and-loss')
  const tabs = page.locator('[data-reports-tabs]')
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)

  await enableAdvancedMode(page)
  await page.goto('/reports/profit-and-loss')
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
  // Still not in the flat rail.
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
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

test('help Nieuw hides Nieuwe journaalpost when Geavanceerd is off', async ({ page }) => {
  await anAdministration(page, 'Help Nieuw BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  // `exact: true` — otherwise "Nieuw" also matches the "Nieuwe factuur" group.
  const nieuw = help
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Nieuw', exact: true }) })
  await expect(nieuw.getByRole('heading', { name: 'Nieuw', exact: true })).toBeVisible()
  // Same gate as ⌘K: Eigenaar with Geavanceerd off must not see n j here.
  await expect(nieuw.getByText('Nieuwe journaalpost')).toHaveCount(0)
  await expect(nieuw.getByText('Nieuwe factuur', { exact: true })).toBeVisible()
})

test('⌘K hides Nieuwe journaalpost when Geavanceerd is off', async ({ page }) => {
  await anAdministration(page, 'Palette Nieuw BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('nieuwe journaal')
  await expect(palette.getByRole('option', { name: /Nieuwe journaalpost/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Chord is gated the same way — stays on the dashboard rather than opening
  // /entries/new.
  await page.keyboard.press('n')
  await page.keyboard.press('j')
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await expect(page).not.toHaveURL(/\/entries\/new/)
})

test('a failed Geavanceerd save reverts the switch and shows the toast', async ({ page }) => {
  await anAdministration(page, 'Save Fail BV')

  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
      await route.fulfill({ status: 500, body: 'save failed' })
      return
    }
    await route.continue()
  })

  await openAccountMenu(page)
  const toggle = page.getByRole('switch', { name: /Geavanceerd|Advanced/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()

  // Optimistic flip reverts once the 500 lands.
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const toast = page.getByTestId('advanced-mode-save-failed')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('Geavanceerd is niet opgeslagen. Probeer het opnieuw.')
  await expect(toast.getByRole('button', { name: 'Sluiten' })).toBeVisible()
  // Exactly one live region — the toast, not a second inline alert.
  await expect(page.getByRole('alert')).toHaveCount(1)
})

test('double-click while Geavanceerd save is in flight keeps focus in the menu', async ({
  page,
}) => {
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

  await openAccountMenu(page)
  const menu = page.getByRole('dialog', { name: 'Profiel' })
  const toggle = page.getByRole('switch', { name: /Geavanceerd|Advanced/ })
  await toggle.focus()
  await expect(toggle).toBeFocused()

  await toggle.click()
  // In-flight: busy, still enabled (no dimming), focus stays on the switch.
  await expect(toggle).toHaveAttribute('aria-busy', 'true')
  await expect(toggle).toBeEnabled()
  await expect(toggle).toBeFocused()
  await expect(menu).toBeVisible()

  // Second click is ignored by savingRef — still one POST, focus retained.
  await toggle.click()
  release()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).not.toHaveAttribute('aria-busy')
  await expect(toggle).toBeFocused()
  await expect(menu).toBeVisible()
  expect(posts).toBe(1)
})

test('help Ga naar matches ⌘K order with Geavanceerd off', async ({ page }) => {
  await anAdministration(page, 'Help Volgorde BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  const goTo = help
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Ga naar' }) })
  await expect(goTo.getByRole('heading', { name: 'Ga naar' })).toBeVisible()

  // Flat rail first; advanced destinations (Journaalposten / Proefbalans) last (#107).
  const labels = await goTo.locator('dt').allTextContents()
  const trimmed = labels.map((label) => label.trim())
  expect(trimmed.indexOf('Home')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Rapporten')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Categorieën')).toBeGreaterThan(-1)
  expect(trimmed.indexOf('Grootboekrekeningen')).toBe(-1)
  expect(trimmed.indexOf('Categorieën')).toBeLessThan(trimmed.indexOf('Journaalposten'))
  expect(trimmed.indexOf('Rapporten')).toBeLessThan(trimmed.indexOf('Proefbalans'))
  expect(trimmed.indexOf('Journaalposten')).toBeGreaterThan(trimmed.indexOf('Momentopnames'))
  expect(trimmed.indexOf('Proefbalans')).toBe(trimmed.length - 1)
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

test('turning Geavanceerd off from the menu hides advanced Reports tabs again', async ({
  page,
}) => {
  await anAdministration(page, 'Toggle BV')
  await enableAdvancedMode(page)

  await page.goto('/reports/profit-and-loss')
  const tabs = page.locator('[data-reports-tabs]')
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toBeVisible()

  await setAdvancedMode(page, false)
  await page.goto('/reports/profit-and-loss')
  await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
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
    await expect(
      keeperPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await hydrated(keeperPage)

    await keeperPage.goto('/reports/profit-and-loss')
    const tabs = keeperPage.locator('[data-reports-tabs]')
    await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
    await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

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
    await expect(
      ownerPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await hydrated(ownerPage)

    await ownerPage.goto('/reports/profit-and-loss')
    const tabs = ownerPage.locator('[data-reports-tabs]')
    await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)

    await chooseOption(ownerPage, 'Administratie', 'Admin B')
    await ownerPage.goto('/reports/profit-and-loss')
    await expect(tabs.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
    await expect(tabs.getByRole('link', { name: /Proefbalans/ })).toBeVisible()

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
  await openAccountMenu(page)
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.keyboard.press('Escape')

  await signOut(page)
  await expect(page).toHaveURL(/\/sign-in$/)

  // Same browser context, different user — must see Eigenaar default (off),
  // not the previous account's explicit on.
  await anAdministration(page, 'User Y BV')
  await openAccountMenu(page)
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
})

test('Importeren Geavanceerd checkbox shares the shell toggle', async ({ page }) => {
  await anAdministration(page, 'Moneybird Sync BV')

  await page.goto('/importeren?bron=moneybird')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  // Full navigation remounts the tree; click before hydration toggles the DOM
  // without React onChange, so the shell switch stays off.
  await hydrated(page)

  const wizard = page.getByRole('checkbox', { name: /Geavanceerd|Advanced/ })
  await expect(wizard).not.toBeChecked()

  await wizard.check()
  await expect(page.getByRole('region', { name: 'Profiel' })).toContainText(/Geavanceerd aan/)
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

  await expect(wizard).not.toBeChecked()
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

test('Geavanceerd choice persists across a fresh browser context for the same user', async ({
  browser,
}) => {
  const email = uniqueEmail()
  const first = await browser.newContext()

  try {
    const page = await first.newPage()
    await anAdministration(page, 'Persist BV', email)
    await enableAdvancedMode(page)

    await openAccountMenu(page)
    await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Reload once so we know the server write landed before we throw the
    // cookie jar away — the next context has no cookies of its own.
    await page.reload()
    await hydrated(page)
    await openAccountMenu(page)
    await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
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
      page.locator('[data-reports-tabs]').getByRole('link', { name: /Journaalposten/ }),
    ).toBeVisible()
    await openAccountMenu(page)
    await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
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

test('digit keys switch Reports tabs when Geavanceerd is on', async ({ page }) => {
  await anAdministration(page, 'Tabs BV')
  await enableAdvancedMode(page)
  await page.goto('/reports/profit-and-loss')
  await hydrated(page)

  await page.keyboard.press('5')
  await expect(page).toHaveURL(/\/reports\/trial-balance/)
  await expect(page.getByRole('heading', { name: 'Proefbalans' })).toBeVisible()

  await page.keyboard.press('6')
  await expect(page).toHaveURL(/\/entries/)
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()

  await page.keyboard.press('1')
  await expect(page).toHaveURL(/\/reports\/profit-and-loss/)
})

test('Settings hub lists Overstappen naar Klopt', async ({ page }) => {
  await anAdministration(page, 'Settings Hub BV')
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Overstappen naar Klopt' })).toBeVisible()
  await page.getByRole('link', { name: 'Importeren openen' }).click()
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
