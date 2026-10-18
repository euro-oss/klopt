import { expect, test, type Page } from '@playwright/test'

/**
 * Redesign focus outlines must paint (#63 PM re-review).
 *
 * Tailwind 4's `outline-2` reuses `--tw-outline-style`. A leftover
 * `outline-none` on the same element leaves style `none` with width 2px —
 * invisible. Class-string unit tests cannot catch that; computed styles can.
 */

async function outlineOf(page: Page, testId: string) {
  const el = page.getByTestId(testId)
  await el.focus()
  return el.evaluate((node) => {
    const s = getComputedStyle(node)
    return {
      style: s.outlineStyle,
      width: s.outlineWidth,
      offset: s.outlineOffset,
      color: s.outlineColor,
      borderColor: s.borderColor,
    }
  })
}

async function assertFocusOutline(
  page: Page,
  testId: string,
  expectedOffset: string,
): Promise<void> {
  const outline = await outlineOf(page, testId)
  expect(outline.style, `${testId} outline-style`).toBe('solid')
  expect(outline.width, `${testId} outline-width`).toBe('2px')
  expect(outline.offset, `${testId} outline-offset`).toBe(expectedOffset)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`focus outline (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
      await page.addInitScript((t) => {
        // Match the app's theme class on <html> before first paint.
        document.documentElement.classList.toggle('dark', t === 'dark')
      }, theme)
      await page.goto('/lab/primitives')
      await expect(page.getByRole('heading', { name: 'Primitives lab' })).toBeVisible()
    })

    test('primary Button shows a 2px solid offset outline on Tab focus', async ({ page }) => {
      await page.keyboard.press('Tab')
      const btn = page.getByTestId('lab-primary-button')
      await expect(btn).toBeFocused()
      await assertFocusOutline(page, 'lab-primary-button', '2px')
    })

    test('Input shows a 2px solid outline with offset 0', async ({ page }) => {
      await page.getByTestId('lab-input').focus()
      await assertFocusOutline(page, 'lab-input', '0px')
    })

    test('invalid Input keeps a destructive border', async ({ page }) => {
      const invalid = page.getByTestId('lab-input-invalid')
      await invalid.focus()
      await assertFocusOutline(page, 'lab-input-invalid', '0px')

      const border = await invalid.evaluate((node) => getComputedStyle(node).borderColor)
      const destructive = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
      )
      // Resolve --destructive through a probe so we compare computed colours.
      const expected = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.color = 'var(--destructive)'
        document.body.appendChild(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      })
      expect(border, `aria-invalid border (${destructive})`).toBe(expected)
    })
  })
}
