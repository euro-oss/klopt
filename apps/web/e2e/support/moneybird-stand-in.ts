/**
 * Loopback Moneybird REST stand-in for browser e2e (#90).
 *
 * The Moneybird page stores a base URL; localhost / 127.0.0.1 is allowed so a
 * real HTTP stand-in can drive connect → choose → preview without reaching
 * moneybird.com. Shapes match the fake used by unit tests.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const ADMIN = {
  id: 123456,
  name: 'Voorbeeld BV',
  language: 'nl',
  currency: 'EUR',
  country: 'NL',
  time_zone: 'Europe/Amsterdam',
  period_start_date: '2026-01-01',
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

const CONTACTS = [
  {
    id: 100,
    company_name: 'Klant BV',
    customer_id: '1001',
    country: 'NL',
  },
  {
    id: 200,
    company_name: 'Leverancier BV',
    customer_id: '2001',
    country: 'NL',
  },
]

const JOURNAL = [
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

export interface MoneybirdStandIn {
  readonly baseUrl: string
  readonly token: string
  close(): Promise<void>
}

/** Null-% purchase + sales rates with totalTax 0 so VGEEN / 0% sales are offered. */
export async function startNullRateMoneybirdStandIn(): Promise<MoneybirdStandIn> {
  const token = 'mb-e2e-null-rate-token'
  const taxRates = [
    {
      id: 90,
      name: 'Geen btw',
      percentage: null,
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    },
    {
      id: 91,
      name: 'Geen btw verkoop',
      percentage: null,
      tax_rate_type: 'sales_invoice',
      country: 'NL',
      active: true,
    },
  ]
  const purchases = [
    {
      id: 401,
      contact_id: 200,
      reference: 'LEV-NULL',
      date: '2026-03-05',
      due_date: '2026-04-05',
      currency: 'EUR',
      state: 'open',
      total_price_excl_tax: '100.00',
      total_price_incl_tax: '100.00',
      total_tax: '0.00',
      details: [
        {
          id: 4011,
          description: 'Huur',
          amount: '1',
          price: '100.00',
          tax_rate_id: 90,
          ledger_account_id: 6,
        },
      ],
      attachments: [],
    },
  ]
  const sales = [
    {
      id: 301,
      contact_id: 100,
      invoice_id: '2026-NULL',
      state: 'open',
      invoice_date: '2026-03-01',
      due_date: '2026-03-31',
      currency: 'EUR',
      prices_are_incl_tax: false,
      total_price_excl_tax: '50.00',
      total_price_incl_tax: '50.00',
      total_tax: '0.00',
      details: [
        {
          id: 3011,
          description: 'Advies',
          amount: '1',
          price: '50.00',
          tax_rate_id: 91,
          ledger_account_id: 7,
        },
      ],
      attachments: [],
    },
  ]

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401)
      res.end('unauthorised')
      return
    }
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.includes('/administrations.json')) {
      json([ADMIN])
      return
    }
    if (url.includes('ledger_accounts.json')) {
      json(LEDGER)
      return
    }
    if (url.includes('tax_rates.json')) {
      json(taxRates)
      return
    }
    if (url.includes('contacts.json')) {
      json(CONTACTS)
      return
    }
    if (url.includes('sales_invoices.json')) {
      json(sales)
      return
    }
    if (url.includes('purchase_invoices.json')) {
      json(purchases)
      return
    }
    if (url.includes('general_journal_documents.json')) {
      json(JOURNAL)
      return
    }
    if (
      url.includes('receipts.json') ||
      url.includes('financial_accounts.json') ||
      url.includes('financial_mutations.json') ||
      url.includes('general_documents.json')
    ) {
      json([])
      return
    }
    json([])
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${String(address.port)}/api/v2`

  return {
    baseUrl,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/**
 * Null-% rates on 2025 documents — after mapping to Klopt codes that start in
 * the fiscal year (2026), preview raises `tax_code_not_in_force` (#99).
 */
export async function startPreValidFromMoneybirdStandIn(): Promise<MoneybirdStandIn> {
  const token = 'mb-e2e-pre-valid-from-token'
  const taxRates = [
    {
      id: 90,
      name: 'Geen btw',
      percentage: null,
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    },
    {
      id: 91,
      name: 'Geen btw verkoop',
      percentage: null,
      tax_rate_type: 'sales_invoice',
      country: 'NL',
      active: true,
    },
  ]
  const purchases = [
    {
      id: 401,
      contact_id: 200,
      reference: 'LEV-2025',
      date: '2025-06-15',
      due_date: '2025-07-15',
      currency: 'EUR',
      state: 'open',
      total_price_excl_tax: '100.00',
      total_price_incl_tax: '100.00',
      total_tax: '0.00',
      details: [
        {
          id: 4011,
          description: 'Huur 2025',
          amount: '1',
          price: '100.00',
          tax_rate_id: 90,
          ledger_account_id: 6,
        },
      ],
      attachments: [],
    },
  ]
  const sales = [
    {
      id: 301,
      contact_id: 100,
      invoice_id: '2025-NULL',
      state: 'open',
      invoice_date: '2025-06-15',
      due_date: '2025-07-15',
      currency: 'EUR',
      prices_are_incl_tax: false,
      total_price_excl_tax: '50.00',
      total_price_incl_tax: '50.00',
      total_tax: '0.00',
      details: [
        {
          id: 3011,
          description: 'Advies 2025',
          amount: '1',
          price: '50.00',
          tax_rate_id: 91,
          ledger_account_id: 7,
        },
      ],
      attachments: [],
    },
  ]

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401)
      res.end('unauthorised')
      return
    }
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.includes('/administrations.json')) {
      json([ADMIN])
      return
    }
    if (url.includes('ledger_accounts.json')) {
      json(LEDGER)
      return
    }
    if (url.includes('tax_rates.json')) {
      json(taxRates)
      return
    }
    if (url.includes('contacts.json')) {
      json(CONTACTS)
      return
    }
    if (url.includes('sales_invoices.json')) {
      json(sales)
      return
    }
    if (url.includes('purchase_invoices.json')) {
      json(purchases)
      return
    }
    if (url.includes('general_journal_documents.json')) {
      json(JOURNAL)
      return
    }
    if (
      url.includes('receipts.json') ||
      url.includes('financial_accounts.json') ||
      url.includes('financial_mutations.json') ||
      url.includes('general_documents.json')
    ) {
      json([])
      return
    }
    json([])
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${String(address.port)}/api/v2`

  return {
    baseUrl,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/**
 * Null-% purchase whose document still carries VAT — blocks with
 * `null_percentage_vat_mismatch` and offers no VGEEN (#90 PM).
 */
export async function startNullRateVatMismatchMoneybirdStandIn(): Promise<MoneybirdStandIn> {
  const token = 'mb-e2e-null-rate-vat-mismatch-token'
  const taxRates = [
    {
      id: 95,
      name: 'Geen btw',
      percentage: null,
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    },
  ]
  const purchases = [
    {
      id: 401,
      contact_id: 200,
      reference: 'LEV-VAT',
      date: '2026-03-05',
      due_date: '2026-04-05',
      currency: 'EUR',
      state: 'open',
      prices_are_incl_tax: false,
      total_price_excl_tax: '100.00',
      total_price_incl_tax: '121.00',
      total_tax: '21.00',
      details: [
        {
          id: 4011,
          description: 'Huur',
          amount: '1',
          price: '100.00',
          tax_rate_id: 95,
          ledger_account_id: 6,
        },
      ],
      attachments: [],
    },
  ]

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401)
      res.end('unauthorised')
      return
    }
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.includes('/administrations.json')) {
      json([ADMIN])
      return
    }
    if (url.includes('ledger_accounts.json')) {
      json(LEDGER)
      return
    }
    if (url.includes('tax_rates.json')) {
      json(taxRates)
      return
    }
    if (url.includes('contacts.json')) {
      json(CONTACTS)
      return
    }
    if (url.includes('sales_invoices.json')) {
      json([])
      return
    }
    if (url.includes('purchase_invoices.json')) {
      json(purchases)
      return
    }
    if (url.includes('general_journal_documents.json')) {
      json(JOURNAL)
      return
    }
    if (
      url.includes('receipts.json') ||
      url.includes('financial_accounts.json') ||
      url.includes('financial_mutations.json') ||
      url.includes('general_documents.json')
    ) {
      json([])
      return
    }
    json([])
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${String(address.port)}/api/v2`

  return {
    baseUrl,
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
