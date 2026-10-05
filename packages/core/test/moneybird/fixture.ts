import {
  parseAdministration,
  parseContact,
  parseFinancialAccount,
  parseFinancialMutation,
  parseGeneralDocument,
  parseJournalDocument,
  parseLedgerAccount,
  parsePurchaseInvoice,
  parseReceipt,
  parseSalesInvoice,
  parseTaxRate,
  type MoneybirdSnapshot,
} from '../../src/index.js'

/**
 * A small Moneybird administration, parsed from public API v2 shapes.
 *
 * Built the way Exact's fixture is: raw rows, then the real parsers. A
 * snapshot of our own types would skip the layer most likely to be wrong.
 */

export const ADMINISTRATION = parseAdministration({
  id: 123456,
  name: 'Voorbeeld BV',
  language: 'nl',
  currency: 'EUR',
  country: 'NL',
  time_zone: 'Europe/Amsterdam',
})

const account = (
  id: number,
  number: string,
  name: string,
  accountType: string,
): Record<string, unknown> => ({
  id,
  account_id: number,
  name,
  account_type: accountType,
  parent_id: null,
  allowed_document_types: [],
  is_system: false,
  rgs_code: null,
})

const LEDGER = [
  account(1, '1100', 'Bank', 'current_assets'),
  account(2, '1300', 'Debiteuren', 'current_assets'),
  account(3, '1500', 'BTW af te dragen', 'current_liabilities'),
  account(4, '1510', 'BTW te vorderen', 'current_assets'),
  account(5, '1600', 'Crediteuren', 'current_liabilities'),
  account(6, '4000', 'Inkoopkosten', 'direct_costs'),
  account(7, '8000', 'Omzet', 'sales'),
  account(8, '0500', 'Kapitaal', 'equity'),
]

const TAX = [
  {
    id: 21,
    name: 'BTW hoog 21%',
    percentage: '21.0',
    tax_rate_type: 'sales_invoice',
    country: 'NL',
    active: true,
  },
  {
    id: 22,
    name: 'Voorbelasting hoog 21%',
    percentage: '21.0',
    tax_rate_type: 'purchase_invoice',
    country: 'NL',
    active: true,
  },
]

const CONTACTS = [
  {
    id: 100,
    company_name: 'Klant BV',
    customer_id: '1001',
    tax_number: 'NL123456789B01',
    chamber_of_commerce: '12345678',
    send_invoices_to_email: 'klant@example.test',
    phone: null,
    address1: 'Keizersgracht 1',
    zipcode: '1015 AA',
    city: 'Amsterdam',
    country: 'NL',
    sepa_iban: null,
    firstname: null,
    lastname: null,
  },
  {
    id: 200,
    company_name: 'Leverancier BV',
    customer_id: '2001',
    tax_number: null,
    chamber_of_commerce: null,
    send_invoices_to_email: null,
    phone: null,
    address1: null,
    zipcode: null,
    city: null,
    country: 'NL',
    sepa_iban: 'NL00TEST0123456789',
    firstname: null,
    lastname: null,
  },
]

const SALES = [
  {
    id: 301,
    contact_id: 100,
    invoice_id: '2026-001',
    state: 'open',
    invoice_date: '2026-03-01',
    due_date: '2026-03-31',
    reference: null,
    currency: 'EUR',
    prices_are_incl_tax: false,
    total_price_excl_tax: '100.00',
    total_price_incl_tax: '121.00',
    total_tax: '21.00',
    original_sales_invoice_id: null,
    details: [
      {
        id: 3011,
        description: 'Advies',
        amount: '1',
        price: '100.00',
        tax_rate_id: 21,
        ledger_account_id: 7,
      },
    ],
    attachments: [
      {
        id: 901,
        filename: 'factuur-2026-001.pdf',
        content_type: 'application/pdf',
        size: 12,
        download_url: 'https://moneybird.test/files/901',
      },
    ],
  },
]

const PURCHASES = [
  {
    id: 401,
    contact_id: 200,
    reference: 'LEV-88',
    date: '2026-03-05',
    due_date: '2026-04-05',
    currency: 'EUR',
    state: 'open',
    total_price_excl_tax: '100.00',
    total_price_incl_tax: '121.00',
    total_tax: '21.00',
    details: [
      {
        id: 4011,
        description: 'Huur',
        amount: '1',
        price: '100.00',
        tax_rate_id: 22,
        ledger_account_id: 6,
      },
    ],
    attachments: [],
  },
]

const FINANCIAL_ACCOUNTS = [
  {
    id: 501,
    name: 'Rabo',
    identifier: 'NL12MONEYBIRD00000000',
    type: 'bank',
    currency: 'EUR',
    ledger_account_id: 1,
  },
]

const MUTATIONS = [
  {
    id: 601,
    financial_account_id: 501,
    date: '2026-03-10',
    message: 'Betaling 2026-001',
    amount: '121.00',
    contra_account_name: 'Klant BV',
    contra_account_number: null,
    batch_reference: null,
    amount_open: '0.0',
    state: 'processed',
    payments: [
      {
        id: 6011,
        invoice_type: 'SalesInvoice',
        invoice_id: 301,
        price: '121.00',
        payment_date: '2026-03-10',
      },
    ],
  },
]

const JOURNALS = [
  {
    id: 701,
    reference: 'Openingsbalans',
    date: '2026-01-01',
    origin: 'opening',
    general_journal_document_entries: [
      {
        id: 7011,
        ledger_account_id: 2,
        debit: '1000.00',
        credit: '0.00',
        description: 'Debiteuren openingsbalans',
      },
      {
        id: 7012,
        ledger_account_id: 8,
        debit: '0.00',
        credit: '1000.00',
        description: 'Kapitaal',
      },
    ],
    attachments: [],
  },
]

const GENERAL = [
  {
    id: 801,
    reference: 'Archiefstuk',
    date: '2026-02-01',
    contact_id: null,
    attachments: [
      {
        id: 902,
        filename: 'archief.pdf',
        content_type: 'application/pdf',
        size: 4,
        download_url: 'https://moneybird.test/files/902',
      },
    ],
  },
]

export function snapshot(overrides: Partial<MoneybirdSnapshot> = {}): MoneybirdSnapshot {
  return {
    administration: ADMINISTRATION,
    ledgerAccounts: LEDGER.map(parseLedgerAccount),
    taxRates: TAX.map(parseTaxRate),
    contacts: CONTACTS.map(parseContact),
    salesInvoices: SALES.map(parseSalesInvoice),
    purchaseInvoices: PURCHASES.map(parsePurchaseInvoice),
    receipts: [],
    financialAccounts: FINANCIAL_ACCOUNTS.map(parseFinancialAccount),
    financialMutations: MUTATIONS.map(parseFinancialMutation),
    journalDocuments: JOURNALS.map(parseJournalDocument),
    generalDocuments: GENERAL.map(parseGeneralDocument),
    unreadable: [],
    ...overrides,
  }
}

export const RAW = {
  ledger: LEDGER,
  tax: TAX,
  contacts: CONTACTS,
  sales: SALES,
  purchases: PURCHASES,
  receipts: [] as Record<string, unknown>[],
  financialAccounts: FINANCIAL_ACCOUNTS,
  mutations: MUTATIONS,
  journals: JOURNALS,
  general: GENERAL,
}
