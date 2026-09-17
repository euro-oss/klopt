import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KLOPT_VERSION } from '../src/version.js'

/**
 * One version, said once.
 *
 * The constant is what reaches an auditfile, an XBRL instance, `/health` and
 * the OpenAPI document; the root `package.json` is what a reader and a release
 * script look at. Two places is one too many, and the only reason it is
 * tolerable is that this fails when they drift.
 */
describe('the product version', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json')

  it('is the one in the root package.json', () => {
    const declared = (JSON.parse(readFileSync(root, 'utf8')) as { version: string }).version
    expect(KLOPT_VERSION).toBe(declared)
  })

  it('is a plain semantic version', () => {
    // No `v`, no build metadata: it goes into an XAF element a Dutch tax
    // inspector's software reads, and that is not the place to be creative.
    expect(KLOPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
