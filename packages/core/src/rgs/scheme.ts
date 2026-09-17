/**
 * RGS, the Dutch reference chart of accounts (spec 7.1).
 *
 * The scheme is **versioned reference data loaded at runtime, never code**
 * (principle 6). `reference-data/rgs/rgs-<version>-<variant>.json` is generated
 * from the official workbook by `tools/rgs-import`; nothing in this file knows
 * what is in RGS 3.7, only what an RGS scheme looks like.
 *
 * That is the whole point. A new RGS version is a data release: drop in a file,
 * run the diff, migrate the mappings. It is not a deploy.
 */

export type RgsDebitCredit = 'D' | 'C'

export interface RgsCode {
  /** The reference code, e.g. `BVorDebHan`. Hierarchical by prefix. */
  readonly code: string
  /**
   * The omslagcode: where the balance belongs when it lands on the other side.
   * A debtor balance that goes credit is a creditor, and RGS names the code to
   * use. Indirect mapping (spec 7.1) is built on this.
   */
  readonly omslagCode: string | null
  readonly sortKey: string
  /** The decimal reference number, e.g. `1101000`. */
  readonly referenceNumber: string
  readonly shortDescription: string
  readonly description: string
  readonly debitCredit: RgsDebitCredit | null
  /** 1 (BALANS / W&V) to 5 (most detailed). */
  readonly level: number
  readonly inactive: boolean
  /** Applicability filters from the published workbook, verbatim. */
  readonly flags: Readonly<Record<string, boolean>>
}

export interface RgsScheme {
  readonly version: string
  readonly variant: string
  readonly source: string
  readonly codes: readonly RgsCode[]
  get(code: string): RgsCode | undefined
  byReferenceNumber(referenceNumber: string): RgsCode | undefined
  /** The immediate parent, derived from the code prefix hierarchy. */
  parentOf(code: string): RgsCode | undefined
  /** Root-first: `B`, `BVor`, `BVorDeb`, … excluding the code itself. */
  ancestorsOf(code: string): readonly RgsCode[]
  childrenOf(code: string): readonly RgsCode[]
}

export class RgsSchemeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RgsSchemeError'
  }
}

function requireString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string') {
    throw new RgsSchemeError(`${where}: ${field} must be a string.`)
  }
  return value
}

function parseCode(raw: unknown, index: number): RgsCode {
  if (typeof raw !== 'object' || raw === null) {
    throw new RgsSchemeError(`codes[${String(index)}] is not an object.`)
  }
  const source = raw as Record<string, unknown>
  const where = `codes[${String(index)}]`
  const code = requireString(source, 'code', where)

  const debitCredit = source['debitCredit']
  if (debitCredit !== null && debitCredit !== 'D' && debitCredit !== 'C') {
    throw new RgsSchemeError(`${code}: debitCredit must be "D", "C" or null.`)
  }

  const level = source['level']
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
    throw new RgsSchemeError(`${code}: level must be a positive integer.`)
  }

  const omslagCode = source['omslagCode']
  if (omslagCode !== null && typeof omslagCode !== 'string') {
    throw new RgsSchemeError(`${code}: omslagCode must be a string or null.`)
  }

  const flags = source['flags']
  if (typeof flags !== 'object' || flags === null) {
    throw new RgsSchemeError(`${code}: flags must be an object.`)
  }

  return {
    code,
    omslagCode,
    sortKey: requireString(source, 'sortKey', where),
    referenceNumber: requireString(source, 'referenceNumber', where),
    shortDescription: requireString(source, 'shortDescription', where),
    description: requireString(source, 'description', where),
    debitCredit,
    level,
    inactive: source['inactive'] === true,
    flags: flags as Record<string, boolean>,
  }
}

/**
 * Parse and index a scheme file. Validating rather than casting: reference data
 * is the one input that arrives from outside the type system, and a malformed
 * scheme should fail at load with a useful message rather than at the first
 * mapping lookup.
 */
export function loadRgsScheme(raw: unknown): RgsScheme {
  if (typeof raw !== 'object' || raw === null) {
    throw new RgsSchemeError('An RGS scheme file must be a JSON object.')
  }
  const file = raw as Record<string, unknown>

  if (file['scheme'] !== 'rgs') {
    throw new RgsSchemeError('Not an RGS scheme file: "scheme" must be "rgs".')
  }
  const rawCodes = file['codes']
  if (!Array.isArray(rawCodes)) {
    throw new RgsSchemeError('An RGS scheme file must have a "codes" array.')
  }

  const codes = rawCodes.map(parseCode)
  const byCode = new Map<string, RgsCode>()
  const byNumber = new Map<string, RgsCode>()

  for (const code of codes) {
    if (byCode.has(code.code)) throw new RgsSchemeError(`Duplicate reference code ${code.code}.`)
    byCode.set(code.code, code)
    // Reference numbers are not unique across the scheme in every version, so
    // first wins and this index is a convenience, not a key.
    if (!byNumber.has(code.referenceNumber)) byNumber.set(code.referenceNumber, code)
  }

  const declaredCount = file['codeCount']
  if (typeof declaredCount === 'number' && declaredCount !== codes.length) {
    throw new RgsSchemeError(
      `Scheme declares ${String(declaredCount)} codes but contains ${String(codes.length)}.`,
    )
  }

  // The hierarchy is carried by the code prefix: BVorDebHan sits under
  // BVorDeb, which sits under BVor, which sits under B. Computed once, because
  // coverage reporting walks it constantly.
  const parents = new Map<string, string>()
  const children = new Map<string, RgsCode[]>()

  const sorted = [...codes].sort((a, b) => a.code.length - b.code.length)
  for (const code of sorted) {
    for (let length = code.code.length - 1; length > 0; length -= 1) {
      const candidate = code.code.slice(0, length)
      const parent = byCode.get(candidate)
      if (parent === undefined) continue
      parents.set(code.code, candidate)
      const siblings = children.get(candidate) ?? []
      siblings.push(code)
      children.set(candidate, siblings)
      break
    }
  }

  const ancestorCache = new Map<string, readonly RgsCode[]>()

  const scheme: RgsScheme = {
    version: requireString(file, 'version', 'scheme'),
    variant: requireString(file, 'variant', 'scheme'),
    source: typeof file['source'] === 'string' ? file['source'] : '',
    codes,
    get: (code) => byCode.get(code),
    byReferenceNumber: (referenceNumber) => byNumber.get(referenceNumber),
    parentOf: (code) => {
      const parent = parents.get(code)
      return parent === undefined ? undefined : byCode.get(parent)
    },
    ancestorsOf: (code) => {
      const cached = ancestorCache.get(code)
      if (cached !== undefined) return cached

      const chain: RgsCode[] = []
      let current = parents.get(code)
      while (current !== undefined) {
        const parent = byCode.get(current)
        if (parent === undefined) break
        chain.unshift(parent)
        current = parents.get(current)
      }
      ancestorCache.set(code, chain)
      return chain
    },
    childrenOf: (code) => children.get(code) ?? [],
  }

  return scheme
}
