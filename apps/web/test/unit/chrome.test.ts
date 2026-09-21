import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The quiet end of the sidebar, held to the source.
 *
 * The decision is that the bottom of the rail answers one question — whose
 * books am I in — and that language, appearance, role and sign-out are one
 * click behind it. That is the kind of decision which comes undone a line at a
 * time: a setting is "only small", it is "needed right there", and three of
 * them later the block is what it was. The browser specs prove the menu works;
 * this is the shorter statement, in the fast job, of what must not move back.
 */

const shell = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'components', 'app-shell.tsx'),
  'utf8',
)

const menu = shell.slice(shell.indexOf('<PopoverContent'), shell.indexOf('</PopoverContent>'))

describe('the bottom of the sidebar', () => {
  it('keeps the settings behind the row rather than under it', () => {
    expect(menu).not.toBe('')

    for (const inside of [
      '<LanguagePicker />',
      '<ThemePicker />',
      'action="/sign-out"',
      'shell.role',
      'shell.account.signOut',
    ]) {
      expect(menu, inside).toContain(inside)
    }
  })

  it('opens upward, because the trigger is the last thing on the screen', () => {
    expect(menu).toContain('side="top"')
  })

  it('offers Systeem beside Licht and Donker', () => {
    expect(shell).toContain("value: 'system'")
    expect(shell).toContain("t('theme.system')")
  })

  it('does not go live before React does', () => {
    // A row that looks like a menu and swallows the click is the failure
    // `select.tsx` describes; every JS-only control in this shell is disabled
    // until hydration.
    expect(shell).toMatch(/<PopoverTrigger\s+disabled=\{!hydrated\}/)
  })
})
