import { violation, LedgerError, type LedgerViolation } from '../errors.js'
import { formatMinorUnits } from '../format/index.js'
import { XmlWriter, decimalString } from '../xml/writer.js'
import { RUBRIEKEN, findRubriek } from './rubrieken.js'
import type { VatPeriod } from './period.js'
import { rubriekAmounts, type VatReturn } from './return.js'
import type { TaxonomyMapping } from './taxonomy.js'

/**
 * The XBRL instance for a BTW-aangifte (spec 7.2).
 *
 * "Generate the XBRL instance, validate it locally, then hand it to a filing
 * transport adapter."
 *
 * ## Whole euros, rounded once
 *
 * The aangifte is filed in whole euros. The ledger is in cents, so something
 * has to round, and *where* it rounds decides whether the filing is internally
 * consistent. Two orders are possible:
 *
 *  1. Sum the cents, compute 5a and 5c, then round the totals. The boxes then
 *     do not add up: 1a + 1b rounded individually need not equal their rounded
 *     sum, and an aangifte whose own arithmetic fails gets rejected.
 *  2. Round each declared box, then derive 5a, 5b and 5c from the rounded
 *     boxes. Every figure on the form is then exactly the sum of the figures
 *     above it.
 *
 * This does the second. The consequence is that the instance can differ from
 * the cent-accurate return by a euro or two, so the difference is reported
 * rather than hidden — and it is why the *reconciliation* runs against the
 * cent-accurate return while the *instance* carries whole euros. Reconciling
 * against a rounded figure would turn rounding into a blocking difference
 * every quarter.
 *
 * Rounding is half away from zero, on integers only. No `Math.round`, no
 * float: `(cents + 50) / 100` on bigints, with the sign handled explicitly.
 *
 * ## What this does not do
 *
 * It does not validate against the taxonomy. Validating an XBRL instance needs
 * the taxonomy's schemas and linkbases — thousands of files an operator
 * downloads — so that is a separate concern with its own port, exactly as the
 * Peppol schematrons are. What it does do is refuse to build an instance whose
 * mapping is unverified *when the destination is the Belastingdienst*, and say
 * so loudly when it is not.
 */

/** A fact as it appears in the instance, and in the human-readable summary. */
export interface InstanceFact {
  readonly rubriek: string
  readonly kind: 'base' | 'vat'
  readonly element: string
  readonly label: string
  /** Whole euros, as the aangifte wants them. */
  readonly euros: bigint
  /** The cent-accurate figure this was rounded from. */
  readonly minorUnits: bigint
}

export interface VatInstance {
  readonly xml: string
  readonly taxonomyVersion: string
  /** False when the mapping's element names have not been checked against NT. */
  readonly taxonomyVerified: boolean
  readonly schemaRef: string
  readonly facts: readonly InstanceFact[]
  /** Whole euros: what the instance declares for 5a, 5b and 5c. */
  readonly owedEuros: bigint
  readonly deductibleEuros: bigint
  readonly payableEuros: bigint
  /**
   * Whole euros minus the cent-accurate figure, in cents. Non-zero is normal
   * and is rounding; it is reported so nobody has to wonder.
   */
  readonly roundingDifferenceMinorUnits: bigint
  readonly warnings: readonly string[]
}

export interface VatInstanceRequest {
  readonly vatReturn: VatReturn
  readonly period: VatPeriod
  readonly mapping: TaxonomyMapping
  /** The omzetbelastingnummer, which is the instance's entity identifier. */
  readonly vatNumber: string
  readonly legalName: string
  /** Marks the instance as a correction to a period already filed. */
  readonly isSuppletie: boolean
  readonly softwareDesc: string
  readonly softwareVersion: string
}

/** Half away from zero, on integers only. A float has no business here. */
function toEuros(minorUnits: bigint): bigint {
  const negative = minorUnits < 0n
  const magnitude = negative ? -minorUnits : minorUnits
  const rounded = (magnitude + 50n) / 100n
  return negative ? -rounded : rounded
}

/**
 * NL VAT numbers on an aangifte are the omzetbelastingnummer without the `NL`
 * prefix: `123456789B01`, not `NL123456789B01`. The Belastingdienst's own
 * identifier scheme is national, so the country prefix would be part of the
 * value rather than of the scheme.
 */
function omzetbelastingnummer(vatNumber: string): string {
  const normalised = vatNumber.toUpperCase().replace(/\s/g, '')
  return normalised.startsWith('NL') ? normalised.slice(2) : normalised
}

const NL_VAT = /^\d{9}B\d{2}$/

export function checkInstanceRequest(request: VatInstanceRequest): readonly LedgerViolation[] {
  const problems: LedgerViolation[] = []

  const identifier = omzetbelastingnummer(request.vatNumber)
  if (!NL_VAT.test(identifier)) {
    problems.push(
      violation(
        'invalid_vat_number',
        'entity.vatNumber',
        `The aangifte is identified by the omzetbelastingnummer, and ${request.vatNumber} is not one. Fill it in under Instellingen.`,
      ),
    )
  }

  if (request.legalName.trim() === '') {
    problems.push(
      violation('invalid_name', 'entity.legalName', 'The filing needs the entity’s legal name.'),
    )
  }

  if (request.mapping.report !== 'ob-aangifte') {
    problems.push(
      violation(
        'unknown_taxonomy',
        'taxonomy.report',
        `Mapping ${request.mapping.version} maps ${request.mapping.report}, not the BTW-aangifte.`,
      ),
    )
  }

  // Every box the return has a figure for must have somewhere to go. A mapping
  // missing 1b silently drops the low-rate turnover, and the instance would
  // still be well-formed.
  const mapped = new Set(request.mapping.facts.map((fact) => `${fact.rubriek}.${fact.kind}`))
  for (const rubriek of RUBRIEKEN) {
    const amounts = rubriekAmounts(request.vatReturn, rubriek.id)
    if (rubriek.carries !== 'vat' && amounts.baseMinorUnits !== 0n) {
      if (!mapped.has(`${rubriek.id}.base`)) {
        problems.push(
          violation(
            'unknown_taxonomy',
            `taxonomy.facts.${rubriek.id}.base`,
            `Rubriek ${rubriek.id} has a base of ${decimalString(amounts.baseMinorUnits)} and mapping ${request.mapping.version} has no element for it.`,
          ),
        )
      }
    }
    if (rubriek.carries !== 'base' && amounts.vatMinorUnits !== 0n) {
      if (!mapped.has(`${rubriek.id}.vat`)) {
        problems.push(
          violation(
            'unknown_taxonomy',
            `taxonomy.facts.${rubriek.id}.vat`,
            `Rubriek ${rubriek.id} has VAT of ${decimalString(amounts.vatMinorUnits)} and mapping ${request.mapping.version} has no element for it.`,
          ),
        )
      }
    }
  }

  return problems
}

export function generateVatInstance(request: VatInstanceRequest): VatInstance {
  const problems = checkInstanceRequest(request)
  if (problems.length > 0) throw new LedgerError(problems)

  const { mapping, vatReturn } = request
  const exponent = mapping.exponent

  // Round each declared box first, then derive the subtotals from the rounded
  // boxes. See the note at the top of the file.
  const declared = new Map<string, bigint>()
  const facts: InstanceFact[] = []

  for (const fact of mapping.facts) {
    if (fact.rubriek === '5a' || fact.rubriek === '5c') continue
    const amounts = rubriekAmounts(vatReturn, fact.rubriek)
    const minorUnits = fact.kind === 'base' ? amounts.baseMinorUnits : amounts.vatMinorUnits
    const euros = toEuros(minorUnits)
    declared.set(`${fact.rubriek}.${fact.kind}`, euros)
    facts.push({
      rubriek: fact.rubriek,
      kind: fact.kind,
      element: fact.element,
      label: fact.label,
      euros,
      minorUnits,
    })
  }

  const owedEuros = RUBRIEKEN.filter(
    (rubriek) => rubriek.role === 'owed' && !rubriek.computed,
  ).reduce((sum, rubriek) => sum + (declared.get(`${rubriek.id}.vat`) ?? 0n), 0n)
  const deductibleEuros = declared.get('5b.vat') ?? 0n
  const payableEuros = owedEuros - deductibleEuros

  for (const id of ['5a', '5c'] as const) {
    const fact = mapping.facts.find((entry) => entry.rubriek === id && entry.kind === 'vat')
    if (fact === undefined) continue
    const euros = id === '5a' ? owedEuros : payableEuros
    facts.push({
      rubriek: id,
      kind: 'vat',
      element: fact.element,
      label: fact.label,
      euros,
      minorUnits: id === '5a' ? vatReturn.owedMinorUnits : vatReturn.payableMinorUnits,
    })
  }

  // In form order, so the instance reads like the aangifte and a diff between
  // two of them is legible.
  const order = new Map(RUBRIEKEN.map((rubriek, index) => [rubriek.id, index]))
  facts.sort(
    (a, b) =>
      (order.get(a.rubriek) ?? 99) - (order.get(b.rubriek) ?? 99) ||
      (a.kind === 'base' ? 0 : 1) - (b.kind === 'base' ? 0 : 1),
  )

  const warnings: string[] = []
  if (!mapping.verified) {
    warnings.push(
      `Taxonomy mapping ${mapping.version} is marked unverified: its element names have not been checked against the published Nederlandse Taxonomie. The figures are right; the element names may not be. ${mapping.provenance}`.trim(),
    )
  }

  const roundingDifference = payableEuros * 100n - vatReturn.payableMinorUnits
  if (roundingDifference !== 0n) {
    warnings.push(
      `The instance declares whole euros, which differs from the ledger by ${decimalString(roundingDifference)}. Each box is rounded and the totals are derived from the rounded boxes, so the form adds up.`,
    )
  }

  const identifier = omzetbelastingnummer(request.vatNumber)
  const contextId = request.isSuppletie ? 'suppletie' : 'aangifte'
  const unitId = 'EUR'

  const writer = new XmlWriter()
  const namespaces: Record<string, string | null> = {
    'xmlns:xbrli': 'http://www.xbrl.org/2003/instance',
    'xmlns:link': 'http://www.xbrl.org/2003/linkbase',
    'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    'xmlns:iso4217': 'http://www.xbrl.org/2003/iso4217',
  }
  for (const [prefix, uri] of Object.entries(mapping.namespaces)) {
    namespaces[`xmlns:${prefix}`] = uri
  }

  writer.open('xbrli:xbrl', namespaces)
  writer.empty('link:schemaRef', {
    'xlink:type': 'simple',
    'xlink:href': mapping.schemaRef,
  })

  writer.open('xbrli:context', { id: contextId })
  writer.open('xbrli:entity')
  writer.leaf('xbrli:identifier', identifier, { scheme: mapping.entityScheme })
  writer.close('xbrli:entity')
  writer.open('xbrli:period')
  writer.leaf('xbrli:startDate', request.period.from)
  writer.leaf('xbrli:endDate', request.period.to)
  writer.close('xbrli:period')
  writer.close('xbrli:context')

  writer.open('xbrli:unit', { id: unitId })
  writer.leaf('xbrli:measure', 'iso4217:EUR')
  writer.close('xbrli:unit')

  for (const fact of facts) {
    writer.leaf(fact.element, decimalString(fact.euros, exponent), {
      contextRef: contextId,
      unitRef: unitId,
      // Whole euros are exact as declared, not an approximation of the cents.
      decimals: exponent === 0 ? '0' : String(exponent),
    })
  }

  writer.close('xbrli:xbrl')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`

  return {
    xml,
    taxonomyVersion: mapping.version,
    taxonomyVerified: mapping.verified,
    schemaRef: mapping.schemaRef,
    facts,
    owedEuros,
    deductibleEuros,
    payableEuros,
    roundingDifferenceMinorUnits: roundingDifference,
    warnings,
  }
}

/**
 * The instance, for a human.
 *
 * Spec 7.2 asks the manual path for "the instance plus a human-readable
 * summary", and this is that summary: the boxes in form order with the figures
 * to type into Mijn Belastingdienst Zakelijk, whole euros, one per line. Plain
 * text on purpose — it gets pasted into a note, printed, and read over the
 * phone to an accountant.
 */
export function presentFilingSummary(
  instance: VatInstance,
  request: {
    readonly period: VatPeriod
    readonly legalName: string
    readonly vatNumber: string
    readonly isSuppletie: boolean
    readonly generatedOn: string
  },
): string {
  const lines: string[] = []
  // Truncated, not just padded: a label longer than its column pushes the
  // amounts out of line, and a column of figures that does not line up is
  // exactly what somebody retyping into a form misreads.
  const pad = (value: string, width: number) =>
    (value.length > width ? `${value.slice(0, width - 1)}…` : value).padEnd(width)
  const money = (euros: bigint | null) =>
    (euros === null ? '' : decimalString(euros, 0)).padStart(12)

  lines.push(request.isSuppletie ? 'SUPPLETIE OMZETBELASTING' : 'AANGIFTE OMZETBELASTING')
  lines.push('')
  lines.push(`Onderneming        ${request.legalName}`)
  lines.push(`Omzetbelastingnr.  ${request.vatNumber}`)
  lines.push(
    `Periode            ${request.period.label} (${request.period.from} t/m ${request.period.to})`,
  )
  lines.push(`Taxonomie          ${instance.taxonomyVersion}`)
  lines.push(`Opgesteld op       ${request.generatedOn}`)
  lines.push('')
  lines.push('Bedragen in hele euro’s, zoals de aangifte ze vraagt.')
  lines.push('')
  lines.push(
    `  ${'Rubriek'.padEnd(4)}${''.padEnd(52)}${'Grondslag'.padStart(12)}${'BTW'.padStart(12)}`,
  )

  let section: string | null = null
  for (const rubriek of RUBRIEKEN) {
    const base = instance.facts.find((fact) => fact.rubriek === rubriek.id && fact.kind === 'base')
    const vat = instance.facts.find((fact) => fact.rubriek === rubriek.id && fact.kind === 'vat')
    if (base === undefined && vat === undefined) continue

    if (rubriek.section !== section) {
      section = rubriek.section
      lines.push(section)
    }

    const label = findRubriek(rubriek.id)?.label ?? rubriek.id
    // Blank, not zero, for a half the form has no box for. A `0` in a column
    // that does not exist invites somebody to look for the field.
    lines.push(
      `  ${pad(rubriek.id, 4)}${pad(label, 52)}${money(
        rubriek.carries === 'vat' ? null : (base?.euros ?? 0n),
      )}${money(rubriek.carries === 'base' ? null : (vat?.euros ?? 0n))}`,
    )
  }

  lines.push('')
  lines.push(
    instance.payableEuros < 0n
      ? `Terug te vragen: ${decimalString(-instance.payableEuros, 0)} euro`
      : `Te betalen: ${decimalString(instance.payableEuros, 0)} euro`,
  )

  const notes: string[] = []
  if (!instance.taxonomyVerified) {
    notes.push(
      `De taxonomie-mapping ${instance.taxonomyVersion} is nog niet gecontroleerd tegen de gepubliceerde Nederlandse Taxonomie. De bedragen hierboven komen uit het grootboek en zijn juist; de XBRL-elementnamen in het meegeleverde bestand zijn dat misschien niet. Voor het met de hand indienen maakt dat niets uit.`,
    )
  }
  const drift = instance.roundingDifferenceMinorUnits
  if (drift !== 0n) {
    // In words and with a comma, because this is a Dutch document that gets
    // printed. `-0.49` is neither.
    const magnitude = formatMinorUnits(drift < 0n ? -drift : drift)
    notes.push(
      `De aangifte gaat in hele euro’s. Daardoor staat er ${magnitude} ${drift < 0n ? 'minder' : 'meer'} op de aangifte dan in het grootboek. Elke rubriek is apart afgerond en de totalen zijn uit die afgeronde rubrieken berekend, zodat het formulier met zichzelf klopt.`,
    )
  }

  if (notes.length > 0) {
    lines.push('')
    lines.push('LET OP')
    for (const note of notes) lines.push(`  - ${note}`)
  }

  return `${lines.join('\n')}\n`
}
