import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A raw NUL byte in a source file, which has now happened twice.
 *
 * Both times it was the same slip: a NUL written as a literal byte rather than
 * as an escape (`backslash u 0 0 0 0`), meant as a separator or a placeholder. It is worth a
 * test because of how it fails, which is badly in three separate ways:
 *
 *   - **`grep` gives up.** A file containing a NUL is binary as far as most
 *     tools are concerned, so it silently reports nothing. ADR 0025 records a
 *     search that went down a blind alley for exactly this reason.
 *   - **Postgres refuses it.** `invalid byte sequence for encoding "UTF8":
 *     0x00`, raised from a code path with nothing obviously to do with
 *     encodings.
 *   - **Nothing shows it.** It is invisible in an editor and in a diff.
 *
 * The escape behaves identically wherever a separator is genuinely wanted, and
 * leaves the file searchable. So the raw byte is never the right answer.
 *
 * Repository-wide rather than package-wide on purpose: this is a property of the
 * source tree. The first occurrence was in `packages/core` and the second in
 * `packages/db`, and a guard in either one alone would have missed the other.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')

const SKIP = new Set([
  'node_modules',
  'dist',
  '.git',
  '.output',
  '.nitro',
  '.tanstack',
  '.vite',
  'coverage',
  'test-results',
  'playwright-report',
  'reference-data',
  '.klopt',
  '.context',
])

const EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.sql', '.json', '.md']

async function sourceFiles(directory: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue

    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await sourceFiles(path, found)
      continue
    }
    if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path)
  }

  return found
}

describe('the source tree', () => {
  it('contains no raw NUL bytes', async () => {
    const files = await sourceFiles(ROOT)

    // A sanity check on the walk itself: a test that found nothing to look at
    // would pass forever and prove nothing.
    expect(files.length).toBeGreaterThan(200)

    const offenders: string[] = []
    for (const file of files) {
      const bytes = await readFile(file)
      if (bytes.includes(0)) offenders.push(relative(ROOT, file))
    }

    expect(offenders, 'use the escape; the raw byte breaks grep and Postgres').toEqual([])
  }, 30_000)
})
