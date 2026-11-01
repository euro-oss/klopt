import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Fixture / seed PII guard (issue #120).
 *
 * Legal's purge: seeds, e2e fixtures and tests must not carry names close to
 * real people, a banned IBAN (matched by SHA-256 of the normalised form, so
 * the literal never appears in-tree), or third-party domains that showed up in
 * content greps (`hotelzeezicht.nl`, `neverhide.nl`).
 *
 * Scans `apps/` and `packages/` with the full ban set. An optional `design/`
 * tree is scanned for domains and the IBAN hash only — authorship notes like
 * "not drawn by Hidde" / `"by": "Hidde"` must stay allowed there.
 *
 * Docs, NOTICE and MAINTAINERS naming the copyright holder are out of scope.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

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
 * IBAN-shaped tokens: 2 letters + 2 digits + up to 30 alphanumeric characters,
 * with an optional single space before each of those 30. Catches both compact
 * and spaced group forms without requiring a particular grouping.
 */
const IBAN_LIKE = /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){0,30}\b/g

/**
 * SHA-256 (hex) of the normalised banned IBAN. The plaintext must not appear
 * in this repository — compute locally, commit only the digest.
 */
const BANNED_IBAN_SHA256 = '110393691810e8a34adde708be07b14dba4d17b0379f23515237582a4ef99613'

/**
 * @typedef {'apps-packages' | 'design'} Scope
 * @typedef {{ id: string, pattern: RegExp, scopes: readonly Scope[] }} LiteralRule
 */

/** Literal bans. Personal names are case-sensitive so `hidden` is not a hit. */
const LITERAL_BANS = /** @type {readonly LiteralRule[]} */ ([
  { id: 'Hidde', pattern: /\bHidde\b/, scopes: ['apps-packages', 'design'] },
  { id: 'Stokvis', pattern: /\bStokvis\b/, scopes: ['apps-packages', 'design'] },
  {
    id: 'hotelzeezicht.nl',
    pattern: /hotelzeezicht\.nl/i,
    scopes: ['apps-packages', 'design'],
  },
  {
    id: 'neverhide.nl',
    pattern: /neverhide\.nl/i,
    scopes: ['apps-packages', 'design'],
  },
])

/**
 * @param {string} value
 * @returns {string}
 */
function normaliseIban(value) {
  return value.replace(/\s+/g, '').toUpperCase()
}

/**
 * @param {string} normalised
 * @returns {string}
 */
function sha256Hex(normalised) {
  return createHash('sha256').update(normalised, 'utf8').digest('hex')
}

/**
 * @param {string} text
 * @returns {Generator<{ raw: string, normalised: string, hash: string, index: number }>}
 */
function* extractIbans(text) {
  const pattern = new RegExp(IBAN_LIKE.source, IBAN_LIKE.flags)
  for (const match of text.matchAll(pattern)) {
    const raw = match[0] ?? ''
    if (raw === '') continue
    const normalised = normaliseIban(raw)
    // A real IBAN is at least country + check + BBAN stub; skip trivial hits.
    if (normalised.length < 15) continue
    yield {
      raw,
      normalised,
      hash: sha256Hex(normalised),
      index: match.index ?? 0,
    }
  }
}

/**
 * @param {string} text
 * @param {string} bannedHash
 * @returns {{ raw: string, line: number }[]}
 */
function findBannedIbanHits(text, bannedHash) {
  const hits = []
  for (const token of extractIbans(text)) {
    if (token.hash !== bannedHash) continue
    const line = text.slice(0, token.index).split(/\r?\n/).length
    hits.push({ raw: token.raw, line })
  }
  return hits
}

/**
 * @param {string} directory
 * @param {string[]} files
 */
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

/**
 * @param {string} path
 * @returns {string}
 */
function rel(path) {
  return relative(REPO_ROOT, path).split(sep).join('/')
}

/**
 * @param {string} pathRel
 * @returns {Scope | null}
 */
function scopeOf(pathRel) {
  if (pathRel === 'apps' || pathRel.startsWith('apps/')) return 'apps-packages'
  if (pathRel === 'packages' || pathRel.startsWith('packages/')) return 'apps-packages'
  if (pathRel === 'design' || pathRel.startsWith('design/')) return 'design'
  return null
}

/**
 * @param {Scope} scope
 * @returns {{ path: string, pathRel: string }[]}
 */
function collectFiles(scope) {
  const roots =
    scope === 'design'
      ? [join(REPO_ROOT, 'design')]
      : [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')]

  const files = []
  for (const root of roots) {
    try {
      if (statSync(root).isDirectory()) walk(root, files)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }
  return files.map((path) => ({ path, pathRel: rel(path) }))
}

/**
 * @param {Scope} scope
 * @returns {string[]}
 */
function scanScope(scope) {
  const guardSelf = rel(fileURLToPath(import.meta.url))
  const findings = []
  const literalRules = LITERAL_BANS.filter((rule) => rule.scopes.includes(scope))

  for (const { path, pathRel } of collectFiles(scope)) {
    if (pathRel === guardSelf) continue
    if (scopeOf(pathRel) !== scope) continue

    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }

    for (const rule of literalRules) {
      if (!rule.pattern.test(text)) continue
      // RegExp with /g retains lastIndex; rebuild for line lookup.
      const linePattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''))
      const line = text.split(/\r?\n/).findIndex((row) => linePattern.test(row)) + 1
      findings.push(`${pathRel}:${String(line)} contains banned fixture literal ${rule.id}`)
    }

    for (const hit of findBannedIbanHits(text, BANNED_IBAN_SHA256)) {
      findings.push(
        `${pathRel}:${String(hit.line)} contains banned IBAN (sha256 ${BANNED_IBAN_SHA256.slice(0, 12)}…)`,
      )
    }
  }

  return findings
}

describe('fixture PII guard (#120)', () => {
  it('rejects Hidde, Stokvis, banned-IBAN hash, hotelzeezicht.nl and neverhide.nl under apps/ and packages/', () => {
    const findings = scanScope('apps-packages')
    expect(findings, findings.join('\n')).toEqual([])
  })

  it('rejects only domains and the banned-IBAN hash under design/ (names stay allowed)', () => {
    const findings = scanScope('design')
    expect(findings, findings.join('\n')).toEqual([])
  })

  it('catches a spaced IBAN form via hash, without embedding the production ban', () => {
    // Synthetic pair generated in this test only — never the production IBAN.
    const synthetic = 'NL00TEST0123456789'
    const bannedHash = sha256Hex(normaliseIban(synthetic))
    const spaced = 'NL00 TEST 0123 4567 89'
    const hits = findBannedIbanHits(`Creditor: ${spaced}\n`, bannedHash)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.raw).toBe(spaced)
    expect(normaliseIban(hits[0]?.raw ?? '')).toBe(synthetic)
    // Production digest must not equal this synthetic one (guards against
    // accidentally wiring the real ban into this example).
    expect(bannedHash).not.toBe(BANNED_IBAN_SHA256)
  })
})
