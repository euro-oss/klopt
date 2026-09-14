import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { violation, LedgerError } from '../errors.js'

/**
 * The Nederlandse Taxonomie, as versioned reference data (spec 7.2).
 *
 * "The taxonomy is versioned reference data. Filing selects the taxonomy
 * version by reporting period, not by 'latest'."
 *
 * That sentence is the whole design. A new NT is published every year through
 * an alpha, a beta and a definitive release, and a Q4 2026 aangifte filed in
 * January 2027 must go out against the taxonomy that was current *for 2026* —
 * not the one that happens to be newest when somebody presses the button. So a
 * mapping declares the periods it applies to and selection is by the return's
 * period, with no fallback to newest. A period with no mapping loaded is a
 * refusal that names the version needed, which is principle 6: a compliance
 * artefact is data loaded at runtime, and an instance that cannot be built is
 * better than one built against the wrong year.
 *
 * ## What is in the file, and what is not
 *
 * What is here is the *mapping*: which XBRL element each rubriek's base and VAT
 * amount becomes, the entrypoint to reference, and the namespaces. That is a
 * page of data.
 *
 * What is not here is the taxonomy itself — thousands of schema and linkbase
 * files. Validating an instance against it needs the real thing, which an
 * operator downloads and points `KLOPT_REFERENCE_DATA_DIR` at, exactly as with
 * the RGS scheme and the Peppol schematrons.
 *
 * ## `verified`
 *
 * A mapping shipped in this repository carries `verified: false` until somebody
 * has checked its element names against the published taxonomy. An unverified
 * mapping still generates an instance — an operator filing by hand wants the
 * figures either way — but the transports that hand it to the Belastingdienst
 * refuse, and the summary says so at the top. Guessing an element name produces
 * an instance that looks right and declares the wrong box, which is the worst
 * available outcome and the one this flag exists to prevent.
 */

export class TaxonomyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxonomyError'
  }
}

/** Which half of a rubriek an element carries. */
export type TaxonomyFactKind = 'base' | 'vat'

export interface TaxonomyFact {
  readonly rubriek: string
  readonly kind: TaxonomyFactKind
  /** The qualified element name, e.g. `bd-i:TaxedTurnoverSuppliesServicesGeneral`. */
  readonly element: string
  /** Dutch label, so the human-readable summary needs no second source. */
  readonly label: string
}

export interface TaxonomyMapping {
  /** `NT20`, `NT21`. */
  readonly version: string
  /** Which report this maps, e.g. `ob-aangifte`. */
  readonly report: string
  /**
   * The reporting periods this version applies to. Inclusive, and the only
   * thing selection looks at — there is deliberately no "latest".
   */
  readonly appliesFrom: string
  readonly appliesTo: string | null
  /** The entrypoint the instance references in `link:schemaRef`. */
  readonly schemaRef: string
  readonly namespaces: Readonly<Record<string, string>>
  /** The scheme for the entity identifier: the omzetbelastingnummer. */
  readonly entityScheme: string
  /**
   * Amounts on the aangifte are whole euros, which the mapping states rather
   * than the generator assuming.
   */
  readonly exponent: number
  readonly facts: readonly TaxonomyFact[]
  /** False until the element names have been checked against the published NT. */
  readonly verified: boolean
  /** Where this file came from, for the person who has to check it. */
  readonly provenance: string
}

function requireString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value === '') {
    throw new TaxonomyError(`${where}: ${field} must be a non-empty string.`)
  }
  return value
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function loadTaxonomyMapping(raw: unknown): TaxonomyMapping {
  if (typeof raw !== 'object' || raw === null) {
    throw new TaxonomyError('A taxonomy mapping must be an object.')
  }
  const file = raw as Record<string, unknown>

  if (file['taxonomy'] !== 'klopt.nt-mapping') {
    throw new TaxonomyError('Not a taxonomy mapping: "taxonomy" must be "klopt.nt-mapping".')
  }

  const version = requireString(file, 'version', 'mapping')
  const where = `mapping ${version}`

  const appliesFrom = requireString(file, 'appliesFrom', where)
  if (!ISO_DATE.test(appliesFrom)) {
    throw new TaxonomyError(`${where}: appliesFrom must be a date.`)
  }
  const rawTo = file['appliesTo']
  if (rawTo !== null && rawTo !== undefined && typeof rawTo !== 'string') {
    throw new TaxonomyError(`${where}: appliesTo must be a date or null.`)
  }
  const appliesTo = typeof rawTo === 'string' ? rawTo : null
  if (appliesTo !== null && !ISO_DATE.test(appliesTo)) {
    throw new TaxonomyError(`${where}: appliesTo must be a date or null.`)
  }
  if (appliesTo !== null && appliesTo < appliesFrom) {
    throw new TaxonomyError(`${where}: appliesTo is before appliesFrom.`)
  }

  const rawNamespaces = file['namespaces']
  if (typeof rawNamespaces !== 'object' || rawNamespaces === null) {
    throw new TaxonomyError(`${where}: namespaces must be an object.`)
  }
  const namespaces: Record<string, string> = {}
  for (const [prefix, uri] of Object.entries(rawNamespaces as Record<string, unknown>)) {
    if (typeof uri !== 'string' || uri === '') {
      throw new TaxonomyError(`${where}: namespace ${prefix} must be a URI.`)
    }
    namespaces[prefix] = uri
  }

  const rawFacts = file['facts']
  if (!Array.isArray(rawFacts) || rawFacts.length === 0) {
    throw new TaxonomyError(`${where}: a mapping with no facts maps nothing.`)
  }

  const seen = new Set<string>()
  const facts: TaxonomyFact[] = rawFacts.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TaxonomyError(`${where}: facts[${String(index)}] is not an object.`)
    }
    const fact = entry as Record<string, unknown>
    const kind = fact['kind']
    if (kind !== 'base' && kind !== 'vat') {
      throw new TaxonomyError(`${where}: facts[${String(index)}].kind must be base or vat.`)
    }
    const rubriek = requireString(fact, 'rubriek', `${where}.facts[${String(index)}]`)
    const key = `${rubriek}.${kind}`
    if (seen.has(key)) {
      throw new TaxonomyError(`${where}: rubriek ${rubriek}'s ${kind} is mapped twice.`)
    }
    seen.add(key)

    const element = requireString(fact, 'element', `${where}.facts[${String(index)}]`)
    if (!element.includes(':')) {
      throw new TaxonomyError(
        `${where}: element ${element} has no namespace prefix. An unprefixed element cannot be resolved.`,
      )
    }
    const [prefix] = element.split(':')
    if (prefix === undefined || !Object.hasOwn(namespaces, prefix)) {
      throw new TaxonomyError(
        `${where}: element ${element} uses undeclared prefix ${String(prefix)}.`,
      )
    }

    return {
      rubriek,
      kind,
      element,
      label: requireString(fact, 'label', `${where}.facts[${String(index)}]`),
    }
  })

  const exponent = file['exponent']
  if (exponent !== undefined && (typeof exponent !== 'number' || !Number.isInteger(exponent))) {
    throw new TaxonomyError(`${where}: exponent must be an integer.`)
  }

  return {
    version,
    report: requireString(file, 'report', where),
    appliesFrom,
    appliesTo,
    schemaRef: requireString(file, 'schemaRef', where),
    namespaces,
    entityScheme: requireString(file, 'entityScheme', where),
    exponent: typeof exponent === 'number' ? exponent : 0,
    facts,
    verified: file['verified'] === true,
    provenance: typeof file['provenance'] === 'string' ? file['provenance'] : '',
  }
}

/**
 * The mapping for a reporting period.
 *
 * By period, never by "latest" — that is the requirement, and it is why this
 * throws rather than falling back. A refusal naming the version needed is
 * something an operator can act on; an instance quietly built against next
 * year's taxonomy is not.
 */
export function selectTaxonomyMapping(
  mappings: readonly TaxonomyMapping[],
  request: { readonly report: string; readonly periodFrom: string; readonly periodTo: string },
): TaxonomyMapping {
  const forReport = mappings.filter((mapping) => mapping.report === request.report)
  const matching = forReport.filter(
    (mapping) =>
      mapping.appliesFrom <= request.periodFrom &&
      (mapping.appliesTo === null || mapping.appliesTo >= request.periodTo),
  )

  if (matching.length === 0) {
    const loaded = forReport.map((mapping) => mapping.version).join(', ') || '(none)'
    throw new LedgerError([
      violation('unknown_taxonomy.taxonomy_mapping_covers', 'taxonomy', {
        report: request.report,
        periodFrom: request.periodFrom,
        periodTo: request.periodTo,
        loaded,
      }),
    ])
  }

  if (matching.length > 1) {
    // Two mappings claiming one period means one of them has the wrong window,
    // and picking either would be a guess about which.
    throw new LedgerError([
      violation('unknown_taxonomy.taxonomy_mappings_claim', 'taxonomy', {
        count: String(matching.length),
        periodFrom: request.periodFrom,
        periodTo: request.periodTo,
        versions: matching.map((mapping) => mapping.version).join(', '),
      }),
    ])
  }

  return matching[0]!
}

/** Every mapping under a reference-data directory. Empty when there is none. */
export function loadTaxonomyMappingsFromDirectory(directory: string): readonly TaxonomyMapping[] {
  const path = join(directory, 'nt')

  let files: string[]
  try {
    files = readdirSync(path).filter((name) => name.endsWith('.json'))
  } catch {
    // No directory is legitimate: an installation that files by hand and never
    // generates an instance needs none.
    return []
  }

  const mappings: TaxonomyMapping[] = []
  for (const name of files) {
    const file = join(path, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error: unknown) {
      throw new TaxonomyError(
        `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    mappings.push(loadTaxonomyMapping(parsed))
  }

  return mappings.sort(
    (a, b) => a.report.localeCompare(b.report) || a.appliesFrom.localeCompare(b.appliesFrom),
  )
}
