import {
  parseAccount,
  parseAttachment,
  parseDocument,
  parseGLAccount,
  parseOpenItem,
  parsePaymentCondition,
  parseReportingBalance,
  parseVatCode,
  type ExactDivision,
  type ExactSnapshot,
} from '../../src/index.js'

/**
 * A small Exact division, built from raw rows rather than from our own types.
 *
 * Deliberately built by running the real parsers over objects shaped the way
 * Exact's reference documentation says its rows are shaped — padded codes,
 * `Edm.Double` amounts, `/Date(ms)/` where the older endpoints use it. A
 * fixture made of `ExactGLAccount` literals would test the planner and skip the
 * layer most likely to be wrong.
 */

export const DIVISION: ExactDivision = {
  code: 3196493,
  description: 'Voorbeeld BV',
  currency: 'EUR',
  country: 'NL',
  vatNumber: 'NL123456789B01',
  chamberOfCommerceNumber: '12345678',
  status: 1,
  isMainDivision: true,
  isPracticeDivision: false,
  isDossierDivision: false,
  archiveDate: null,
  current: true,
}

const guid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

/** Exact pads `crm/Accounts.Code` to eighteen characters. */
const padded = (code: string): string => code.padStart(18, ' ')

const GL_ACCOUNTS = [
  {
    ID: guid(1),
    Code: '1000',
    Description: 'Kas',
    BalanceSide: 'D',
    BalanceType: 'B',
    Type: 10,
    TypeDescription: 'Cash',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: 'BLimKasKas',
  },
  {
    ID: guid(2),
    Code: '1100',
    Description: 'Bank',
    BalanceSide: 'D',
    BalanceType: 'B',
    Type: 12,
    TypeDescription: 'Bank',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: 'BLimBanRba',
  },
  {
    ID: guid(3),
    Code: '1300',
    Description: 'Debiteuren',
    BalanceSide: 'D',
    BalanceType: 'B',
    Type: 20,
    TypeDescription: 'Accounts receivable',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: 'BVorDebHad',
  },
  {
    ID: guid(4),
    Code: '1600',
    Description: 'Crediteuren',
    BalanceSide: 'C',
    BalanceType: 'B',
    Type: 22,
    TypeDescription: 'Accounts payable',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: 'BSchCreHac',
  },
  {
    ID: guid(5),
    Code: '0500',
    Description: 'Eigen vermogen',
    BalanceSide: 'C',
    BalanceType: 'B',
    Type: 50,
    TypeDescription: 'Capital stock',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: null,
  },
  {
    ID: guid(6),
    Code: '8000',
    Description: 'Omzet',
    BalanceSide: 'C',
    BalanceType: 'W',
    Type: 110,
    TypeDescription: 'Revenue',
    IsBlocked: false,
    VATCode: 'H',
    ReportingCode: null,
  },
  {
    ID: guid(7),
    Code: '4000',
    Description: 'Kantoorkosten',
    BalanceSide: 'D',
    BalanceType: 'W',
    Type: 121,
    TypeDescription: 'SG&A',
    IsBlocked: false,
    VATCode: 'H1',
    ReportingCode: null,
  },
  {
    ID: guid(8),
    Code: '1500',
    Description: 'BTW af te dragen',
    BalanceSide: 'C',
    BalanceType: 'B',
    Type: 24,
    TypeDescription: 'VAT',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: null,
  },
  {
    ID: guid(9),
    Code: '1520',
    Description: 'BTW te vorderen',
    BalanceSide: 'D',
    BalanceType: 'B',
    Type: 24,
    TypeDescription: 'VAT',
    IsBlocked: false,
    VATCode: null,
    ReportingCode: null,
  },
]

const VAT_CODES = [
  {
    Code: 'H',
    Description: 'BTW hoog verkoop',
    Percentage: 0.21,
    Type: 'E',
    VATTransactionType: 'S',
    IsBlocked: false,
    Charged: false,
  },
  {
    Code: 'H1',
    Description: 'BTW hoog inkoop',
    Percentage: 0.21,
    Type: 'E',
    VATTransactionType: 'P',
    IsBlocked: false,
    Charged: false,
  },
  {
    Code: 'OUD',
    Description: 'BTW 19% (oud)',
    Percentage: 0.19,
    Type: 'E',
    VATTransactionType: 'B',
    IsBlocked: true,
    Charged: false,
  },
]

const ACCOUNTS = [
  {
    ID: guid(101),
    Code: padded('1000'),
    Name: 'Klant Een BV',
    Type: 'A',
    Status: 'C',
    IsSales: true,
    IsSupplier: false,
    Blocked: false,
    VATNumber: 'NL001122334B01',
    ChamberOfCommerce: '11111111',
    Email: 'facturen@klanteen.nl',
    Phone: '0201234567',
    Website: null,
    AddressLine1: 'Keizersgracht 1',
    AddressLine2: null,
    Postcode: '1015 CJ',
    City: 'Amsterdam',
    State: null,
    Country: 'NL',
    PaymentConditionSales: '30',
    PaymentConditionPurchase: null,
  },
  {
    ID: guid(102),
    Code: padded('2000'),
    Name: 'Leverancier Twee BV',
    Type: 'A',
    Status: 'A',
    IsSales: false,
    IsSupplier: true,
    Blocked: false,
    VATNumber: 'NL556677889B01',
    ChamberOfCommerce: '22222222',
    Email: null,
    Phone: null,
    Website: null,
    AddressLine1: 'Stationsweg 2',
    AddressLine2: null,
    Postcode: '3013 AJ',
    City: 'Rotterdam',
    State: null,
    Country: 'NL',
    PaymentConditionSales: null,
    PaymentConditionPurchase: 'EOM',
  },
  {
    // One of the user's own divisions, appearing as a relation. Not a contact.
    ID: guid(103),
    Code: padded('9999'),
    Name: 'Voorbeeld BV',
    Type: 'D',
    Status: null,
    IsSales: false,
    IsSupplier: false,
    Blocked: false,
    VATNumber: null,
    ChamberOfCommerce: null,
    Email: null,
    Phone: null,
    Website: null,
    AddressLine1: null,
    AddressLine2: null,
    Postcode: null,
    City: null,
    State: null,
    Country: 'NL',
    PaymentConditionSales: null,
    PaymentConditionPurchase: null,
  },
]

const PAYMENT_CONDITIONS = [
  { Code: '30', Description: '30 dagen netto', PaymentDays: 30, PaymentEndOfMonths: 0 },
  { Code: 'EOM', Description: 'Einde maand + 14 dagen', PaymentDays: 14, PaymentEndOfMonths: 1 },
]

/** Two open receivables and one payable, totalling 3 025,00 and 605,00. */
const RECEIVABLES = [
  {
    HID: 900001,
    AccountId: guid(101),
    AccountCode: padded('1000'),
    AccountName: 'Klant Een BV',
    Amount: 1210,
    AmountInTransit: 0,
    CurrencyCode: 'EUR',
    Description: 'Factuur 2026-001',
    DueDate: '2026-02-15T00:00:00',
    InvoiceDate: '2026-01-16T00:00:00',
    InvoiceNumber: 20260001,
    EntryNumber: 20260001,
    JournalCode: '70',
    YourRef: 'PO-441',
  },
  {
    HID: 900002,
    AccountId: guid(101),
    AccountCode: padded('1000'),
    AccountName: 'Klant Een BV',
    Amount: 1815,
    AmountInTransit: 0,
    CurrencyCode: 'EUR',
    Description: 'Factuur 2026-002',
    DueDate: '2026-03-01T00:00:00',
    InvoiceDate: '2026-01-30T00:00:00',
    InvoiceNumber: 20260002,
    EntryNumber: 20260002,
    JournalCode: '70',
    YourRef: null,
  },
]

const PAYABLES = [
  {
    HID: 900101,
    AccountId: guid(102),
    AccountCode: padded('2000'),
    AccountName: 'Leverancier Twee BV',
    Amount: 605,
    AmountInTransit: 0,
    CurrencyCode: 'EUR',
    Description: 'Inkoopfactuur',
    DueDate: '2026-02-28T00:00:00',
    InvoiceDate: '2026-01-29T00:00:00',
    InvoiceNumber: 700045,
    EntryNumber: 700045,
    JournalCode: '80',
    YourRef: 'LEV-2026-88',
  },
]

/**
 * A trial balance that balances and whose control accounts agree with the open
 * items: 1300 holds 3 025,00 debit and 1600 holds 605,00 credit.
 *
 * 3 630,00 each way. Two periods on 1300 rather than one, because
 * `ReportingBalance` is per period and a planner that read only the first would
 * understate every account — and one of them is `Status: 20`, unprocessed,
 * which is the row an import that filtered on processed rows would miss.
 */
const TRIAL_BALANCE = [
  // Two sales invoices: 2 500,00 revenue plus 525,00 VAT, 3 025,00 receivable.
  {
    GLAccountCode: '1300',
    GLAccountDescription: 'Debiteuren',
    BalanceType: 'B',
    AmountDebit: 1210,
    AmountCredit: 0,
    Amount: 1210,
    Count: 1,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
  {
    GLAccountCode: '1300',
    GLAccountDescription: 'Debiteuren',
    BalanceType: 'B',
    AmountDebit: 1815,
    AmountCredit: 0,
    Amount: 1815,
    Count: 1,
    ReportingYear: 2026,
    ReportingPeriod: 2,
    Status: 20,
  },
  {
    GLAccountCode: '8000',
    GLAccountDescription: 'Omzet',
    BalanceType: 'W',
    AmountDebit: 0,
    AmountCredit: 2500,
    Amount: -2500,
    Count: 2,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
  {
    GLAccountCode: '1500',
    GLAccountDescription: 'BTW af te dragen',
    BalanceType: 'B',
    AmountDebit: 0,
    AmountCredit: 525,
    Amount: -525,
    Count: 2,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
  // One purchase invoice: 500,00 cost plus 105,00 VAT, 605,00 payable.
  {
    GLAccountCode: '1600',
    GLAccountDescription: 'Crediteuren',
    BalanceType: 'B',
    AmountDebit: 0,
    AmountCredit: 605,
    Amount: -605,
    Count: 1,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
  {
    GLAccountCode: '4000',
    GLAccountDescription: 'Kantoorkosten',
    BalanceType: 'W',
    AmountDebit: 500,
    AmountCredit: 0,
    Amount: 500,
    Count: 1,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
  {
    GLAccountCode: '1520',
    GLAccountDescription: 'BTW te vorderen',
    BalanceType: 'B',
    AmountDebit: 105,
    AmountCredit: 0,
    Amount: 105,
    Count: 1,
    ReportingYear: 2026,
    ReportingPeriod: 1,
    Status: 50,
  },
]
const DOCUMENTS = [
  {
    ID: guid(201),
    Subject: 'Inkoopfactuur januari',
    DocumentDate: '/Date(1769817600000)/',
    AccountCode: padded('2000'),
    AccountName: 'Leverancier Twee BV',
    Type: 10,
    TypeDescription: 'Inkoopfactuur',
    Category: null,
    CategoryDescription: null,
    AmountFC: 605,
    Currency: 'EUR',
    SalesInvoiceNumber: null,
    HID: 1234,
  },
]

const ATTACHMENTS = [
  {
    ID: guid(301),
    Document: guid(201),
    FileName: 'inkoopfactuur.pdf',
    FileSize: 48_112,
    Url: 'https://start.exactonline.nl/docs/XMLDownload.aspx?Topic=DocumentAttachment&id=301',
  },
  // No URL: reported, not fetched.
  { ID: guid(302), Document: guid(201), FileName: 'onbereikbaar.pdf', FileSize: 100, Url: null },
]

export function snapshot(overrides: Partial<ExactSnapshot> = {}): ExactSnapshot {
  return {
    division: DIVISION,
    glAccounts: GL_ACCOUNTS.map(parseGLAccount),
    vatCodes: VAT_CODES.map(parseVatCode),
    accounts: ACCOUNTS.map(parseAccount),
    paymentConditions: PAYMENT_CONDITIONS.map(parsePaymentCondition),
    receivables: RECEIVABLES.map(parseOpenItem),
    payables: PAYABLES.map(parseOpenItem),
    trialBalance: TRIAL_BALANCE.map(parseReportingBalance),
    year: 2026,
    documents: DOCUMENTS.map(parseDocument),
    attachments: ATTACHMENTS.map(parseAttachment),
    ...overrides,
  }
}

/** Raw rows, for tests that want to bend one field. */
export const RAW = {
  glAccounts: GL_ACCOUNTS,
  vatCodes: VAT_CODES,
  accounts: ACCOUNTS,
  receivables: RECEIVABLES,
  payables: PAYABLES,
  trialBalance: TRIAL_BALANCE,
  documents: DOCUMENTS,
  attachments: ATTACHMENTS,
  padded,
  guid,
}
