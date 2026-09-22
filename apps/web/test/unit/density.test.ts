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
    expect(shell).toContain('flex-1 p-4 outline-none')
    expect(shell).not.toContain('flex-1 p-8 outline-none')
    expect(shell).toContain('mb-4 flex items-start justify-between gap-4')
    expect(shell).toContain('text-xl font-semibold tracking-tight')
    expect(shell).toContain('px-3 pb-2')
    expect(shell).not.toContain('focus:rounded')
  })

  it('keeps the command palette scrim and panel readable in both themes', () => {
    const palette = read('components/command-palette.tsx')
    expect(palette).toContain('bg-foreground/30')
    expect(palette).not.toContain('bg-black/30')
    expect(palette).toContain('bg-popover')
    // Cursor must not be bg-muted on bg-popover — invisible in Donker.
    // Selected chrome (keycaps, muted prefixes) follows accent-foreground.
    expect(palette).toContain('bg-accent text-accent-foreground')
    expect(palette).toContain('!border-black !text-black')
    expect(palette).toContain("'text-black'")
    expect(palette).not.toMatch(/index === cursor && 'bg-muted'/)
  })

  it('marks the keyboard with --ring, not yellow type or a primary hairline', () => {
    expect(read('components/ui/keycap.tsx')).toContain('border-ring')
    expect(read('components/ui/keycap.tsx')).not.toContain('border-primary')
    expect(read('components/ui/button.tsx')).toMatch(/link:\s*'text-foreground/)
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

    // Home empty: one line + next action, no body paragraph.
    const home = read('routes/_app/index.tsx')
    expect(home).toContain("t('queue.empty')")
    expect(home).toContain("t('queue.emptyAction')")
    expect(home).not.toContain("t('queue.emptyBody')")
  })
})
