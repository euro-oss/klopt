/**
 * The fictional people and firms that populate the demo BV (issue #48).
 *
 * Everything here is static and deterministic. Amounts and day offsets are
 * derived from `DEMO_SEED` so a re-run produces byte-identical books.
 */

import {
  DEMO_ENTITY_NAME,
  DEMO_FISCAL_YEAR,
  DEMO_IBAN,
  DEMO_KVK,
  DEMO_LEGAL_NAME,
  DEMO_SEED,
  DEMO_VAT,
  DEMO_YEAR_START,
} from './constants.js'
import { assertFictionalDataset, type DemoPiiSubject } from './pii.js'

export interface DemoContact {
  readonly number: string
  readonly name: string
  readonly isCustomer: boolean
  readonly isSupplier: boolean
  readonly email: string
  readonly iban: string
  readonly kvkNumber: string
  readonly vatNumber: string
  readonly street: string
  readonly houseNumber: string
  readonly postalCode: string
  readonly city: string
}

/** Mulberry32 — small, deterministic, good enough for invoice day offsets. */
export function createRng(seed: number = DEMO_SEED): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function testIban(accountIndex: number): string {
  // Pre-computed valid NL..TEST IBANs (see constants / generator). Index 0 is
  // the entity's own account; contacts start at 1.
  const IBANS = [
    'NL69TEST0000000001',
    'NL51TEST1000000000',
    'NL24TEST1000000001',
    'NL94TEST1000000002',
    'NL67TEST1000000003',
    'NL40TEST1000000004',
    'NL13TEST1000000005',
    'NL83TEST1000000006',
    'NL56TEST1000000007',
    'NL29TEST1000000008',
    'NL02TEST1000000009',
    'NL72TEST1000000010',
    'NL45TEST1000000011',
    'NL18TEST1000000012',
    'NL88TEST1000000013',
    'NL61TEST1000000014',
    'NL34TEST1000000015',
    'NL07TEST1000000016',
    'NL77TEST1000000017',
    'NL50TEST1000000018',
    'NL23TEST1000000019',
    'NL93TEST1000000020',
    'NL66TEST1000000021',
    'NL39TEST1000000022',
    'NL12TEST1000000023',
  ] as const
  return IBANS[accountIndex % IBANS.length]!
}

const CUSTOMER_NAMES = [
  'Atlas Voorbeeld Handel (demo)',
  'Noorderlicht Diensten (demo)',
  'Polder Soft B.V. (demo)',
  'Kade & Co (demo)',
  'Fictieve Fietsen (demo)',
  'Zandbank Advies (demo)',
  'Molenaar Media (demo)',
  'Dijkzicht Design (demo)',
  'Havenmeester Horeca (demo)',
  'Windvaan Workshops (demo)',
] as const

const SUPPLIER_NAMES = [
  'Kantoorpapier Proef (demo)',
  'Telecom Fictief (demo)',
  'Huur Demo Vastgoed (demo)',
  'Boekhoudhulp Voorbeeld (demo)',
  'Brandstof Teststation (demo)',
  'Reclame Sample (demo)',
  'Software Licentie Demo (demo)',
  'Schoonmaak Voorbeeld (demo)',
  'Verzekering Fictief (demo)',
  'Internet Voorbeeld (demo)',
] as const

const CITIES = ['Amsterdam', 'Utrecht', 'Rotterdam', 'Haarlem', 'Amersfoort'] as const
const STREETS = ['Demostraat', 'Voorbeeldweg', 'Fictiefplein', 'Proeflaan', 'Testkade'] as const

function contact(
  number: string,
  name: string,
  kind: 'customer' | 'supplier',
  index: number,
): DemoContact {
  const slug = number.toLowerCase()
  return {
    number,
    name,
    isCustomer: kind === 'customer',
    isSupplier: kind === 'supplier',
    email: `${slug}@example.nl`,
    iban: testIban(index + 1),
    kvkNumber: `0000${String(1000 + index).padStart(4, '0')}`,
    vatNumber: `NL00000${String(1000 + index).padStart(4, '0')}B99`,
    street: STREETS[index % STREETS.length]!,
    houseNumber: String(10 + index),
    postalCode: `${String(1000 + index)} AB`,
    city: CITIES[index % CITIES.length]!,
  }
}

export const DEMO_CUSTOMERS: readonly DemoContact[] = CUSTOMER_NAMES.map((name, index) =>
  contact(`C${String(index + 1).padStart(3, '0')}`, name, 'customer', index),
)

export const DEMO_SUPPLIERS: readonly DemoContact[] = SUPPLIER_NAMES.map((name, index) =>
  contact(`S${String(index + 1).padStart(3, '0')}`, name, 'supplier', index + 10),
)

export const DEMO_CONTACTS: readonly DemoContact[] = [...DEMO_CUSTOMERS, ...DEMO_SUPPLIERS]

/** Sales tax codes used across the year: high, low, and zero. */
export const SALES_TAX_CYCLE = ['H21', 'H21', 'L9', 'H21', 'GEEN', 'H21', 'L9', 'H21'] as const

export const PURCHASE_TAX_CYCLE = ['VH21', 'VH21', 'VL9', 'VH21', 'VH21'] as const

export const EXPENSE_ACCOUNTS = ['4400', '4410', '4200', '4420', '4300', '4500', '4900'] as const

export interface PlannedSale {
  readonly contactNumber: string
  readonly issueDate: string
  readonly unitPrice: bigint
  readonly quantity: string
  readonly taxCode: (typeof SALES_TAX_CYCLE)[number]
  readonly description: string
  /** When true, a matching bank receipt is expected later. */
  readonly expectPayment: boolean
}

export interface PlannedPurchase {
  readonly contactNumber: string
  readonly invoiceDate: string
  readonly netMinorUnits: bigint
  readonly taxCode: (typeof PURCHASE_TAX_CYCLE)[number]
  readonly accountNumber: (typeof EXPENSE_ACCOUNTS)[number]
  readonly description: string
  readonly supplierInvoiceNumber: string
  readonly withAttachment: boolean
}

function dateOnDayOfYear(dayOffset: number): string {
  const start = Date.UTC(2025, 0, 1)
  const date = new Date(start + dayOffset * 86_400_000)
  return date.toISOString().slice(0, 10)
}

/**
 * Forty sales invoices across the year, mixing 21%, 9% and 0% VAT.
 *
 * The last five are left unpaid on purpose so the work queue has open items
 * after the bank statement is matched.
 */
export function planSales(rng: () => number = createRng()): readonly PlannedSale[] {
  const sales: PlannedSale[] = []
  for (let i = 0; i < 40; i += 1) {
    const customer = DEMO_CUSTOMERS[i % DEMO_CUSTOMERS.length]!
    const day = 5 + Math.floor(rng() * 350)
    const unitPrice = BigInt(5_000 + Math.floor(rng() * 95_000))
    sales.push({
      contactNumber: customer.number,
      issueDate: dateOnDayOfYear(day),
      unitPrice,
      quantity: '1.000',
      taxCode: SALES_TAX_CYCLE[i % SALES_TAX_CYCLE.length]!,
      description: `Demo levering ${String(i + 1).padStart(2, '0')}`,
      expectPayment: i < 35,
    })
  }
  return sales
}

/** Forty purchase invoices; a few carry a fictional PDF attachment. */
export function planPurchases(
  rng: () => number = createRng(DEMO_SEED ^ 0xa5a5),
): readonly PlannedPurchase[] {
  const purchases: PlannedPurchase[] = []
  for (let i = 0; i < 40; i += 1) {
    const supplier = DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length]!
    const day = 3 + Math.floor(rng() * 350)
    const net = BigInt(2_500 + Math.floor(rng() * 40_000))
    purchases.push({
      contactNumber: supplier.number,
      invoiceDate: dateOnDayOfYear(day),
      netMinorUnits: net,
      taxCode: PURCHASE_TAX_CYCLE[i % PURCHASE_TAX_CYCLE.length]!,
      accountNumber: EXPENSE_ACCOUNTS[i % EXPENSE_ACCOUNTS.length]!,
      description: `Demo inkoop ${String(i + 1).padStart(2, '0')}`,
      supplierInvoiceNumber: `INK-DEMO-${DEMO_FISCAL_YEAR}-${String(i + 1).padStart(4, '0')}`,
      withAttachment: i < 5,
    })
  }
  return purchases
}

export function entityPiiSubjects(): readonly DemoPiiSubject[] {
  return [
    {
      kind: 'entity',
      name: DEMO_ENTITY_NAME,
      email: 'administratie@example.nl',
      iban: DEMO_IBAN,
      kvkNumber: DEMO_KVK,
      vatNumber: DEMO_VAT,
      notes: DEMO_LEGAL_NAME,
    },
    ...DEMO_CONTACTS.map((item) => ({
      kind: item.isCustomer ? 'customer' : 'supplier',
      name: item.name,
      email: item.email,
      iban: item.iban,
      kvkNumber: item.kvkNumber,
      vatNumber: item.vatNumber,
    })),
  ]
}

/** Run the PII guard against the static dataset. Safe to call from tests. */
export function assertDemoDatasetIsFictional(): void {
  assertFictionalDataset(entityPiiSubjects())
}

export function entityAddress() {
  return {
    street: 'Demostraat',
    houseNumber: '1',
    postalCode: '1000 AA',
    city: 'Amsterdam',
    countryCode: 'NL' as const,
    email: 'administratie@example.nl',
    phone: null,
    website: 'https://demo.example.nl',
    iban: DEMO_IBAN,
    bic: null,
  }
}

export { DEMO_YEAR_START }
