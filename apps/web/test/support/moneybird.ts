/**
 * A fake Moneybird REST API v2, shared by the suites that need one.
 *
 * `globalThis.fetch` is replaced rather than a client injected, so the
 * handlers run as they do in production. Rows are shaped the way Moneybird's
 * public docs describe them: integer ids, decimal-string amounts, paginated
 * arrays. No real tokens or customer data.
 */

export interface FakeMoneybird {
  readonly asked: string[]
  administrations: readonly Record<string, unknown>[]
  forbidden: Set<string>
  otherCurrency: boolean
  malformed: boolean
  /**
   * When set, every administration's `period_start_date` uses this month.
   * `null` keeps the January default. Set `omitPeriodStart` to leave the field off.
   */
  fiscalYearStartMonth: number | null
  omitPeriodStart: boolean
}

const LEDGER = [
  { id: 1, account_id: '1100', name: 'Bank', account_type: 'current_assets' },
  { id: 2, account_id: '1300', name: 'Debiteuren', account_type: 'current_assets' },
  { id: 3, account_id: '1500', name: 'BTW af te dragen', account_type: 'current_liabilities' },
  { id: 4, account_id: '1510', name: 'BTW te vorderen', account_type: 'current_assets' },
  { id: 5, account_id: '1600', name: 'Crediteuren', account_type: 'current_liabilities' },
  { id: 6, account_id: '4000', name: 'Inkoopkosten', account_type: 'direct_costs' },
  { id: 7, account_id: '8000', name: 'Omzet', account_type: 'sales' },
  { id: 8, account_id: '0500', name: 'Kapitaal', account_type: 'equity' },
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
    address1: 'Keizersgracht 1',
    zipcode: '1015 AA',
    city: 'Amsterdam',
    country: 'NL',
  },
  {
    id: 200,
    company_name: 'Leverancier BV',
    customer_id: '2001',
    country: 'NL',
    sepa_iban: 'NL00TEST0123456789',
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
    currency: 'EUR',
    prices_are_incl_tax: false,
    total_price_excl_tax: '100.00',
    total_price_incl_tax: '121.00',
    total_tax: '21.00',
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
    attachments: [
      {
        id: 903,
        filename: 'bon-lev-88.pdf',
        content_type: 'application/pdf',
        size: 8,
        download_url: 'https://moneybird.test/files/903',
      },
    ],
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

export function fakeMoneybird(): FakeMoneybird {
  const state: FakeMoneybird = {
    asked: [],
    forbidden: new Set(),
    otherCurrency: false,
    malformed: false,
    fiscalYearStartMonth: null,
    omitPeriodStart: false,
    administrations: [
      {
        id: 123456,
        name: 'Voorbeeld BV',
        language: 'nl',
        currency: 'EUR',
        country: 'NL',
        time_zone: 'Europe/Amsterdam',
        period_start_date: '2026-01-01',
      },
      {
        id: 654321,
        name: 'Oefenadministratie',
        language: 'nl',
        currency: 'EUR',
        country: 'NL',
        time_zone: 'Europe/Amsterdam',
        period_start_date: '2026-01-01',
      },
    ],
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    state.asked.push(url)

    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    if (authorization !== 'Bearer mb-test-token') {
      return Promise.resolve(new Response('unauthorised', { status: 401 }))
    }

    if (url.includes('/files/')) {
      const stamp = Number((url.split('/').pop() ?? '0').replace(/\D/g, '')) % 256
      return Promise.resolve(new Response(new Uint8Array([37, 80, 68, 70, stamp]), { status: 200 }))
    }

    if (url.includes('/administrations.json')) {
      const rows = state.administrations.map((row) => {
        const next: Record<string, unknown> = {
          ...row,
          ...(state.otherCurrency ? { currency: 'GBP' } : {}),
        }
        if (state.omitPeriodStart) {
          delete next['period_start_date']
          delete next['fiscal_year_start_month']
        } else if (state.fiscalYearStartMonth !== null) {
          next['period_start_date'] =
            `2026-${String(state.fiscalYearStartMonth).padStart(2, '0')}-01`
        }
        return next
      })
      return Promise.resolve(json(rows))
    }

    for (const path of state.forbidden) {
      if (url.includes(path)) return Promise.resolve(new Response('forbidden', { status: 403 }))
    }

    const serve = (fragment: string, rows: readonly Record<string, unknown>[]) => {
      if (!url.includes(fragment)) return null
      return json(state.malformed ? [{ nope: true }] : rows)
    }

    return Promise.resolve(
      serve('ledger_accounts.json', LEDGER) ??
        serve('tax_rates.json', TAX) ??
        serve('contacts.json', CONTACTS) ??
        serve('sales_invoices.json', SALES) ??
        serve('documents/purchase_invoices.json', PURCHASES) ??
        serve('documents/receipts.json', []) ??
        serve('financial_accounts.json', FINANCIAL_ACCOUNTS) ??
        serve('financial_mutations.json', MUTATIONS) ??
        serve('documents/general_journal_documents.json', JOURNALS) ??
        serve('documents/general_documents.json', GENERAL) ??
        json([]),
    )
  }

  return state
}
