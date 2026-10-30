import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Alpha 5 density and dark-mode chrome, held to the source.
 *
 * The Design AC for the remaining #8 slice is a list of class names that must
 * not come back: yellow type, yellow hairline cursors, a black scrim, and the
 * 32–48px chrome. Browser specs prove the screens render; this is the shorter
 * statement, in the fast job, of what must not move back.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

describe('Alpha 5 density and dark mode', () => {
  it('keeps main inset and page headers tight', () => {
    const shell = read('components/app-shell.tsx')
    // Phone keeps p-4 + bottom pad for PhoneTabBar; desktop md:p-8 / md:pb-8 (#107).
    expect(shell).toContain('min-w-0 flex-1 scroll-mt-12 p-4 pb-24 outline-none md:p-8 md:pb-8')
    // Header stacks CTAs full-width below md so 390px does not overflow (#67).
    expect(shell).toContain(
      'mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between',
    )
    expect(shell).toContain('text-xl font-semibold tracking-tight')
    expect(shell).not.toContain('focus:rounded')
  })

  it('keeps the command palette scrim and panel readable in both themes', () => {
    const palette = read('components/command-palette.tsx')
    // Shared --overlay token with Sheet (not foreground/30, not black/20).
    expect(palette).toContain('bg-overlay')
    expect(palette).not.toContain('bg-foreground/30')
    expect(palette).not.toContain('bg-black/30')
    expect(palette).toContain('bg-popover')
    // Cursor must not be bg-muted on bg-popover — invisible in Donker.
    // Selected chrome (keycaps, muted prefixes) follows accent-foreground.
    expect(palette).toContain('bg-accent text-accent-foreground')
    expect(palette).toContain('!border-accent-foreground !text-accent-foreground')
    expect(palette).toContain("'text-accent-foreground'")
    expect(palette).not.toContain('text-black')
    expect(palette).not.toMatch(/index === cursor && 'bg-muted'/)
  })

  it('marks the keyboard with prototype keycaps, not yellow ring type', () => {
    const keycap = read('components/ui/keycap.tsx')
    expect(keycap).toContain('border-border')
    expect(keycap).toContain('border-b-2')
    expect(keycap).toContain('text-muted-foreground')
    expect(keycap).toContain('text-[11px]')
    expect(keycap).not.toContain('border-ring')
    expect(keycap).not.toContain('border-primary')
    // Link variant uses --link (ink + underline), not bare foreground (#107 a11y).
    expect(read('components/ui/button.tsx')).toMatch(/link:\s*'text-link/)
    expect(read('components/finance/ledger-table.tsx')).toContain('outline-ring')
    expect(read('components/finance/ledger-table.tsx')).not.toContain('outline-primary')
    expect(read('components/finance/ledger-table.tsx')).not.toContain('bg-primary/5')
    expect(read('routes/_app/inbox.tsx')).not.toContain('outline-primary')
    expect(read('routes/_app/bank.match.tsx')).not.toContain('outline-primary')
  })

  it('keeps empty states hairline, left aligned, and not shouted', () => {
    const empty = read('components/ui/empty.tsx')
    expect(empty).toContain('items-start')
    expect(empty).toContain('border p-4')
    expect(empty).not.toContain('border-dashed')
    expect(empty).not.toContain('p-12')
    expect(empty).not.toContain('tracking-wider uppercase')
    expect(empty).not.toContain('text-primary')

    // Home empty: title, body from the prototype, and the same CTA as the header.
    const home = read('routes/_app/index.tsx')
    expect(home).toContain("t('queue.empty')")
    expect(home).toContain("t('queue.emptyBody')")
    expect(home).toContain("t('queue.emptyAction')")
  })
})
