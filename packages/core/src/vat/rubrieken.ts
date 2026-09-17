/**
 * The BTW-aangifte, as a structure.
 *
 * The Dutch return is a fixed form of numbered boxes — rubrieken — and a tax
 * code's whole job is to say which boxes it feeds (spec 7.2: "the aangifte
 * rubriek it contributes to, for both base and VAT amount"). Modelling the form
 * explicitly, rather than hard-coding `if (rate === 2100) total1a += ...`, is
 * what lets an entity add a tax code without a code change and what makes the
 * reconciliation report able to name what it is reconciling.
 *
 * Two rubrieken deserve a word, because getting them wrong understates what is
 * owed:
 *
 *   - **2a** (heffing naar u verlegd) and **4a/4b** (prestaties uit het
 *     buitenland) are *owed* boxes even though the underlying purchase is an
 *     expense. Under a reverse charge the recipient owes the VAT. Deducting it
 *     again as voorbelasting is a second, separate movement that lands in 5b,
 *     which is why a reverse-charge purchase posts VAT to both control
 *     accounts and needs two tax codes rather than one.
 *   - **1e, 3a, 3b, 3c** carry a base and no VAT. They are not "empty"
 *     rubrieken: 3b is cross-checked against the ICP opgaaf, and a zero rate
 *     applied without the base being declared is exactly the finding an audit
 *     is looking for.
 *
 * Not versioned reference data, unlike the XBRL taxonomy that eventually
 * renders it: the box numbering has been stable for decades, whereas the
 * taxonomy element names change annually. The `until` field exists so that a
 * change *is* expressible without restructuring — 5d, the old
 * kleineondernemersregeling reduction, is the precedent for one.
 */

/** Whether a rubriek reports a taxable base, a VAT amount, or both. */
export type RubriekCarries = 'base' | 'vat' | 'both'

/**
 * How a rubriek's VAT amount reaches the bottom line.
 *
 * `owed` adds to 5a, `deductible` adds to 5b, `informational` does neither —
 * a base-only box has nothing to contribute to the total.
 */
export type RubriekRole = 'owed' | 'deductible' | 'informational'

export interface Rubriek {
  readonly id: string
  /** The heading it sits under on the paper form, for grouped display. */
  readonly section: string
  /** As printed on the form, in Dutch. Operators match on this wording. */
  readonly label: string
  readonly carries: RubriekCarries
  readonly role: RubriekRole
  /**
   * A subtotal the return computes. A tax code may never point at one: 5a is
   * the sum of what is owed, and a code that wrote to it directly would let
   * the return disagree with its own parts.
   */
  readonly computed: boolean
  /** First period this box applies to, `null` for "as long as we have known". */
  readonly since: string | null
  readonly until: string | null
}

function rubriek(
  id: string,
  section: string,
  label: string,
  carries: RubriekCarries,
  role: RubriekRole,
  options: { computed?: boolean; since?: string; until?: string } = {},
): Rubriek {
  return {
    id,
    section,
    label,
    carries,
    role,
    computed: options.computed ?? false,
    since: options.since ?? null,
    until: options.until ?? null,
  }
}

const BINNENLAND = 'Prestaties binnenland'
const VERLEGD = 'Verleggingsregelingen binnenland'
const BUITENLAND = 'Prestaties naar of in het buitenland'
const INKOMEND = 'Prestaties vanuit het buitenland aan u verricht'
const BEREKENING = 'Berekening totaal'

export const RUBRIEKEN: readonly Rubriek[] = [
  rubriek('1a', BINNENLAND, 'Leveringen/diensten belast met hoog tarief', 'both', 'owed'),
  rubriek('1b', BINNENLAND, 'Leveringen/diensten belast met laag tarief', 'both', 'owed'),
  rubriek(
    '1c',
    BINNENLAND,
    'Leveringen/diensten belast met overige tarieven, behalve 0%',
    'both',
    'owed',
  ),
  rubriek('1d', BINNENLAND, 'Privégebruik', 'both', 'owed'),
  rubriek(
    '1e',
    BINNENLAND,
    'Leveringen/diensten belast met 0% of niet bij u belast',
    'base',
    'informational',
  ),

  rubriek(
    '2a',
    VERLEGD,
    'Leveringen/diensten waarbij de omzetbelasting naar u is verlegd',
    'both',
    'owed',
  ),

  rubriek(
    '3a',
    BUITENLAND,
    'Leveringen naar landen buiten de EU (uitvoer)',
    'base',
    'informational',
  ),
  rubriek(
    '3b',
    BUITENLAND,
    'Leveringen naar of diensten in landen binnen de EU',
    'base',
    'informational',
  ),
  rubriek('3c', BUITENLAND, 'Installatie/afstandsverkopen binnen de EU', 'base', 'informational'),

  rubriek('4a', INKOMEND, 'Leveringen/diensten uit landen buiten de EU', 'both', 'owed'),
  rubriek('4b', INKOMEND, 'Leveringen/diensten uit landen binnen de EU', 'both', 'owed'),

  rubriek('5a', BEREKENING, 'Verschuldigde omzetbelasting (rubrieken 1a t/m 4b)', 'vat', 'owed', {
    computed: true,
  }),
  rubriek('5b', BEREKENING, 'Voorbelasting', 'vat', 'deductible'),
  rubriek('5c', BEREKENING, 'Totaal te betalen of terug te vragen', 'vat', 'informational', {
    computed: true,
  }),
]

const BY_ID = new Map(RUBRIEKEN.map((entry) => [entry.id, entry]))

/** The boxes 5a sums. Named once so the return and its tests cannot disagree. */
export const OWED_RUBRIEKEN: readonly string[] = RUBRIEKEN.filter(
  (entry) => entry.role === 'owed' && !entry.computed,
).map((entry) => entry.id)

export function findRubriek(id: string): Rubriek | undefined {
  return BY_ID.get(id)
}

/**
 * Whether a tax code may point at this box.
 *
 * Unknown boxes and the computed subtotals are both refused, with the second
 * being the one a plausible-looking configuration gets wrong.
 */
export function isAssignableRubriek(id: string): boolean {
  const found = BY_ID.get(id)
  return found !== undefined && !found.computed
}

/** Rubrieken in form order, grouped under their printed headings. */
export function rubriekSections(): readonly { section: string; rubrieken: readonly Rubriek[] }[] {
  const sections: { section: string; rubrieken: Rubriek[] }[] = []
  for (const entry of RUBRIEKEN) {
    const last = sections[sections.length - 1]
    if (last !== undefined && last.section === entry.section) last.rubrieken.push(entry)
    else sections.push({ section: entry.section, rubrieken: [entry] })
  }
  return sections
}
