import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * FindingCard keyboard (#41 Phase 1).
 *
 * Inbound findings are the path that needs no Moneybird token: upload a UBL
 * that produces several findings, focus the list, and work it with j/k/Enter/Esc.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/** A document with several inbound findings — no number, no due date, USD. */
const UBL_WITH_FINDINGS = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Foreign Supplier Inc.</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="USD">0.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="USD">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="USD">100.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="USD">100.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Widget</cbc:Name>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Bevindingen BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ })).toBeVisible()
}

test('j/k move between findings, Enter opens the fix, Escape closes it', async ({ page }) => {
  await anAdministration(page)

  await page.goto('/inbox')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bevindingen.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(UBL_WITH_FINDINGS, 'utf8'),
  })

  // Wait for the document card, then for FindingCards inside it.
  await expect(page.getByText('Foreign Supplier Inc.')).toBeVisible()
  const findings = page.locator('[data-slot="finding-card"]')
  await expect(findings.first()).toBeVisible()
  const count = await findings.count()
  expect(count).toBeGreaterThanOrEqual(2)

  // Focus the findings list (first card), then move with j/k.
  await findings.first().focus()
  await expect(findings.first()).toHaveAttribute('data-selected', 'true')

  await page.keyboard.press('j')
  await expect(findings.nth(1)).toHaveAttribute('data-selected', 'true')

  await page.keyboard.press('k')
  await expect(findings.first()).toHaveAttribute('data-selected', 'true')

  // Enter opens the explain-only fix panel.
  await page.keyboard.press('Enter')
  await expect(findings.first()).toHaveAttribute('data-fix-open', 'true')
  await expect(page.getByText(/Waarom dit telt/).first()).toBeVisible()
  await expect(page.getByText('Dit los je niet hier op.')).toBeVisible()

  // Escape closes the fix.
  await page.keyboard.press('Escape')
  await expect(findings.first()).not.toHaveAttribute('data-fix-open', 'true')
})
