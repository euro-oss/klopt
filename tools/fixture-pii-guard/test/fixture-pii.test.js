import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Fixture / seed PII guard (issue #120).
 *
 * Legal's purge: seeds, e2e fixtures and tests must not carry names close to
 * real people, the non-example IBAN `NL91RABO0315273637`, or third-party
 * domains that showed up in content greps (`hotelzeezicht.nl`, `neverhide.nl`).
 *
 * Scans `apps/` and `packages/` (plus an optional `design/` tree when present).
 * The guard file itself is the only place the banned literals may appear as
 * pattern sources. Docs, NOTICE and MAINTAINERS naming the copyright holder
 * are out of scope — same boundary as the issue's `rg` acceptance line.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

const ROOTS = ['apps', 'packages', 'design'].map((name) => join(REPO_ROOT, name))

/** Extensions that can hold fixture literals. */
const TEXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.csv',
  '.xml',
  '.mt940',
  '.html',
  '.md',
  '.txt',
  '.sql',
])

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.output',
  '.tanstack',
  '.nitro',
  'coverage',
  '.outbox',
  '.documents',
  '.klopt',
])

/**
 * Banned literals. Patterns are case-sensitive for personal names (so `hidden`
 * is not a hit) and case-insensitive for domains / the IBAN.
 *
 * Allowlist entries are path suffixes relative to the repo root, using `/`.
 * Keep this list empty unless a hit is justified in the issue — the agreed
 * `jan.jansen@gmail.com` exception lives in the demo PII unit test as a
 * *negative* example, not as a permitted fixture.
 */
const BANNED = [
  {
    id: 'Hidde',
    pattern: /\bHidde\b/,
    allow: [],
  },
  {
    id: 'Stokvis',
    pattern: /\bStokvis\b/,
    allow: [],
  },
  {
    id: 'NL91RABO0315273637',
    pattern: /NL91RABO0315273637/i,
    allow: [],
  },
  {
    id: 'hotelzeezicht.nl',
    pattern: /hotelzeezicht\.nl/i,
    allow: [],
  },
  {
    id: 'neverhide.nl',
    pattern: /neverhide\.nl/i,
    allow: [],
  },
]

function walk(directory, files) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    if (SKIP_DIR.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(path, files)
      continue
    }
    const dot = entry.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : entry.name.slice(dot)
    if (!TEXT.has(ext)) continue
    files.push(path)
  }
}

function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join('/')
}

describe('fixture PII guard (#120)', () => {
  it('rejects Hidde, Stokvis, NL91RABO0315273637, hotelzeezicht.nl and neverhide.nl', () => {
    const files = []
    for (const root of ROOTS) {
      try {
        if (statSync(root).isDirectory()) walk(root, files)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          continue
        }
        throw error
      }
    }

    const guardSelf = rel(fileURLToPath(import.meta.url))
    const findings = []

    for (const path of files) {
      const pathRel = rel(path)
      if (pathRel === guardSelf) continue

      let text
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }

      for (const rule of BANNED) {
        if (rule.allow.includes(pathRel)) continue
        if (!rule.pattern.test(text)) continue
        const line = text.split(/\r?\n/).findIndex((row) => rule.pattern.test(row)) + 1
        findings.push(`${pathRel}:${String(line)} contains banned fixture literal ${rule.id}`)
      }
    }

    expect(findings, findings.join('\n')).toEqual([])
  })
})
