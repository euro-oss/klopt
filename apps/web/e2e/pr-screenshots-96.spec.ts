import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #96 / #94 — Moneybird VAT hard blocks, import cards, XAF alert.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=96 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-96.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '96'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
  await expect(page.getByLabel('Naam van de administratie')).toBeVisible()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  await page.waitForTimeout(250)
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: join(OUT, name), fullPage })
}

async function postEntry(
  page: Page,
  body: Record<string, unknown>,
  key: string,
): Promise<void> {
  const res = await page.request.post('/api/v1/journal-entries', {
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    data: body,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

const VIEWPORTS = [
  ['desktop-1440', { width: 1440, height: 900 }],
  ['mobile-390', { width: 390, height: 844 }],
] as const

test('capture #96 Moneybird VAT return, import cards, XAF alert, summary banner', async ({
  browser,
}) => {
  test.setTimeout(900_000)

  // Import cards: self_assessed (warning) + tax_code_not_in_force (Opnieuw lezen).
  for (const code of ['self_assessed_vat_unsupported', 'tax_code_not_in_force'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `96 ${code} ${theme} ${label}`)
        await page.goto('/lab/import-findings?source=moneybird&state=open')
        await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({
          timeout: 15_000,
        })
        const card = page.locator(`[data-slot="finding-card"][data-code="${code}"]`)
        await card.scrollIntoViewIfNeeded()
        if (code === 'tax_code_not_in_force') {
          await expect(card).toContainText('15-06-2025')
          await card.getByRole('button', { name: 'Opnieuw lezen' }).click()
          await expect(card).toHaveAttribute('data-fix-open', 'true')
        } else {
          await expect(card).toContainText(/btw-verlegging|EU|zelf af te dragen/i)
          await expect(card).toContainText('Open in Moneybird')
          await expect(card).toContainText(/Dit los je niet hier op/)
        }
        await setTheme(page, theme)
        await shoot(
          page,
          `import-${code.replace(/_/g, '-')}-${theme}-${label}.png`,
        )
        await context.close()
      }
    }
  }

  // VAT return: untagged Moneybird VAT (reconciliation + blocked file section).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `96 untagged ${theme} ${label}`)
      await postEntry(
        page,
        {
          journalCode: 'MEM',
          bookingDate: '2026-02-10',
          documentDate: '2026-02-10',
          description: 'Moneybird untagged',
          sourceDocumentRef: 'moneybird:admin:sales_invoice:u1',
          lines: [
            { accountNumber: '1300', debit: '12100' },
            {
              accountNumber: '8000',
              credit: '10000',
              taxCode: 'H21',
              taxRole: 'base',
              taxAmount: '2100',
            },
            { accountNumber: '1500', credit: '2100' },
          ],
        },
        `untagged-${theme}-${label}`,
      )
      await page.goto('/vat/2026-Q1')
      await expect(page.getByText(/Btw van Moneybird-import ontbreekt/i)).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator('span.text-destructive', { hasText: 'telt niet mee' })).toBeVisible()
      await expect(page.getByText(/voorlopig/i)).toBeVisible()
      await expect(page.getByText(/niet via Klopt worden ingediend/i).first()).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `vat-moneybird-untagged-${theme}-${label}.png`, true)
      await context.close()
    }
  }

  // VAT return: reverse-charge / EU self-assessed block.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `96 rc ${theme} ${label}`)
      await postEntry(
        page,
        {
          journalCode: 'MEM',
          bookingDate: '2026-02-12',
          documentDate: '2026-02-12',
          description: 'Moneybird VERL-ONTV',
          sourceDocumentRef: 'moneybird:admin:purchase_invoice:r1',
          lines: [
            {
              accountNumber: '4000',
              debit: '10000',
              taxCode: 'VERL-ONTV',
              taxRole: 'base',
              taxAmount: '0',
            },
            { accountNumber: '1600', credit: '10000' },
          ],
        },
        `rc-${theme}-${label}`,
      )
      await page.goto('/vat/2026-Q1')
      await expect(
        page.getByText(/Moneybird-inkoop met verlegging of EU nog niet te importeren/i),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/niet via Klopt worden ingediend/i).first()).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `vat-moneybird-self-assessed-${theme}-${label}.png`, true)
      await context.close()
    }
  }

  // VAT return: no_rule_in_force (code exists, not on booking date).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `96 no-rule ${theme} ${label}`)
      // H21 in nl-mkb is typically valid from 2026; book in 2025 after opening FY.
      const fy = await page.request.post('/api/v1/fiscal-years', {
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `fy-2025-${theme}-${label}`,
        },
        data: { code: '2025' },
      })
      // Opening FY may already exist — tolerate conflict.
      if (!fy.ok() && fy.status() !== 409 && fy.status() !== 422) {
        expect(fy.ok(), await fy.text()).toBeTruthy()
      }
      const entryRes = await page.request.post('/api/v1/journal-entries', {
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `norule-${theme}-${label}`,
        },
        data: {
          journalCode: 'MEM',
          bookingDate: '2025-06-15',
          documentDate: '2025-06-15',
          description: 'Before valid_from',
          lines: [
            { accountNumber: '1300', debit: '12100' },
            {
              accountNumber: '8000',
              credit: '10000',
              taxCode: 'H21',
              taxRole: 'base',
              taxAmount: '2100',
            },
            {
              accountNumber: '1500',
              credit: '2100',
              taxCode: 'H21',
              taxRole: 'tax',
              taxAmount: '2100',
            },
          ],
        },
      })
      if (entryRes.ok()) {
        await page.goto('/vat/2025-Q2')
        await expect(page.getByText(/niet geldig op de boekdatum|not in force/i)).toBeVisible({
          timeout: 15_000,
        })
        await setTheme(page, theme)
        await shoot(page, `vat-no-rule-in-force-${theme}-${label}.png`, true)
      }
      await context.close()
    }
  }

  // Auditfile: orange Moneybird gap Alert (no role=alert).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `96 xaf ${theme} ${label}`)
      await postEntry(
        page,
        {
          journalCode: 'MEM',
          bookingDate: '2026-03-01',
          documentDate: '2026-03-01',
          description: 'Moneybird for XAF',
          sourceDocumentRef: 'moneybird:admin:sales_invoice:xaf1',
          lines: [
            { accountNumber: '1300', debit: '12100' },
            {
              accountNumber: '8000',
              credit: '10000',
              taxCode: 'H21',
              taxRole: 'base',
              taxAmount: '2100',
            },
            { accountNumber: '1500', credit: '2100' },
          ],
        },
        `xaf-${theme}-${label}`,
      )
      await page.goto('/audit-file')
      await expect(page.getByText(/Moneybird-btw ontbreekt/i)).toBeVisible({ timeout: 20_000 })
      const alert = page.locator('[data-slot="alert"]')
      await expect(alert).toBeVisible()
      await expect(alert).not.toHaveAttribute('role', 'alert')
      await setTheme(page, theme)
      await shoot(page, `auditfile-moneybird-warning-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Summary download text with banner — render as a simple page and shoot once.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, '96 summary banner')
    await postEntry(
      page,
      {
        journalCode: 'MEM',
        bookingDate: '2026-02-20',
        documentDate: '2026-02-20',
        description: 'Moneybird for summary',
        sourceDocumentRef: 'moneybird:admin:sales_invoice:sum1',
        lines: [
          { accountNumber: '1300', debit: '12100' },
          {
            accountNumber: '8000',
            credit: '10000',
            taxCode: 'H21',
            taxRole: 'base',
            taxAmount: '2100',
          },
          { accountNumber: '1500', credit: '2100' },
        ],
      },
      'summary-banner',
    )
    // File a dry preview via the return API isn't available; show the export banner
    // string the summary would carry (same as moneybirdUntaggedVatExportBanner NL).
    const banner =
      'Let op: de btw-totalen in deze export (1a, 5b) missen de btw van geïmporteerde Moneybird-documenten.'
    const html = `<!doctype html><meta charset="utf-8"><title>Samenvatting</title>
      <body style="font:16px/1.5 ui-sans-serif,system-ui;padding:2rem;max-width:40rem;background:#fafafa;color:#111">
      <p style="background:#fff7ed;border-left:4px solid #ea580c;padding:0.75rem 1rem;margin:0 0 1.5rem">${banner}</p>
      <h1 style="font-size:1.25rem">Btw-aangifte 2026-Q1 — samenvatting</h1>
      <p>1a Grondslag € 100,00 · Btw € 0,00</p>
      <p>5b Voorbelasting € 0,00</p>
      <p>5c Te betalen € 0,00</p>
      </body>`
    writeFileSync(join(OUT, 'summary-banner-preview.html'), html)
    await page.setContent(html)
    await shoot(page, 'summary-banner-light-desktop-1440.png')
    await context.close()
  }
})
