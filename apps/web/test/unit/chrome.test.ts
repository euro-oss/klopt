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
      'shell.advanced',
      'role="switch"',
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

const nl = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'i18n', 'nl.ts'),
  'utf8',
)
const en = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'i18n', 'en.ts'),
  'utf8',
)
const dashboard = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'routes', '_app', 'index.tsx'),
  'utf8',
)

describe('demo administration markers (issue #48)', () => {
  it('shows a neutral status banner with the exact NL and EN copy', () => {
    expect(shell).toMatch(/active\?\.isDemo === true/)
    expect(shell).toContain('role="status"')
    expect(shell).toContain('bg-muted')
    expect(shell).toContain("t('shell.demoBanner')")
    expect(nl).toContain(
      'Demo-omgeving: gebruik alleen fictieve gegevens. Voer geen echte boekhouding of persoonsgegevens in.',
    )
    expect(en).toContain(
      "Demo environment: use fictional data only. Don't enter real bookkeeping records or personal data.",
    )
  })

  it('marks demo administrations in the picker', () => {
    expect(shell).toContain("t('shell.demoEntity', { name: entity.entityName })")
    expect(nl).toContain("'shell.demoEntity': '{name} · demo'")
    expect(en).toContain("'shell.demoEntity': '{name} · demo'")
  })

  it('puts the demo badge on the dashboard from the active entity, not memberships[0]', () => {
    expect(dashboard).toContain('getEntity')
    expect(dashboard).toContain('entity.data.isDemo')
    expect(dashboard).toContain("t('shell.demoBadge')")
    expect(dashboard).not.toMatch(/session\.memberships\[0\]/)
    expect(nl).toContain("'shell.demoBadge': 'Demo'")
    expect(en).toContain("'shell.demoBadge': 'Demo'")
  })
})
