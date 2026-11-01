/**
 * Loopback Exact Online OAuth + REST stand-in for browser e2e (#100 Exact VAT).
 *
 * `connectExactBody` allows http://localhost base URLs and redirect URIs so a
 * real HTTP stand-in can walk authorize → callback → divisions → preview
 * without reaching Exact. Shapes match `apps/web/test/support/exact-online.ts`.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { URL } from 'node:url'

const guid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const padded = (code: string): string => code.padStart(18, ' ')

export interface ExactStandIn {
  readonly baseUrl: string
  readonly clientId: string
  readonly clientSecret: string
  close(): Promise<void>
}

export async function startExactStandIn(): Promise<ExactStandIn> {
  const clientId = 'stand-in-client'
  const clientSecret = 'stand-in-secret'
  let accessToken = 'access-1'
  let refreshToken = 'refresh-1'
  let issued = 1

  const collection = (rows: readonly unknown[]) => JSON.stringify({ d: { results: rows } })

  const server: Server = createServer((req, res) => {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname

    const send = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type })
      res.end(body)
    }

    if (path === '/api/oauth2/auth') {
      const redirect = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state')
      if (redirect === null || state === null) {
        send(400, 'missing redirect_uri or state', 'text/plain')
        return
      }
      const target = new URL(redirect)
      target.searchParams.set('code', 'stand-in-code')
      target.searchParams.set('state', state)
      res.writeHead(302, { location: target.toString() })
      res.end()
      return
    }

    if (path === '/api/oauth2/token' && req.method === 'POST') {
      issued += 1
      accessToken = `access-${String(issued)}`
      refreshToken = `refresh-${String(issued)}`
      send(
        200,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: '600',
          token_type: 'bearer',
        }),
      )
      return
    }

    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${accessToken}`) {
      send(401, 'unauthorised', 'text/plain')
      return
    }

    if (path.includes('/current/Me')) {
      send(
        200,
        collection([{ UserID: guid(9), FullName: 'Test Gebruiker', CurrentDivision: 1000 }]),
      )
      return
    }

    if (path.includes('/system/Divisions')) {
      send(
        200,
        collection([
          {
            Code: 1000,
            Description: 'Voorbeeld BV',
            Currency: 'EUR',
            Country: 'NL',
            Status: 1,
            IsMainDivision: true,
            Current: true,
            VATNumber: 'NL000099998B01',
          },
        ]),
      )
      return
    }

    if (path.includes('bulk/Financial/GLAccounts')) {
      send(
        200,
        collection([
          {
            ID: guid(1),
            Code: '1300',
            Description: 'Debiteuren',
            BalanceSide: 'D',
            BalanceType: 'B',
            Type: 20,
            TypeDescription: 'Accounts receivable',
            IsBlocked: false,
            VATCode: '1',
          },
          {
            ID: guid(2),
            Code: '1600',
            Description: 'Crediteuren',
            BalanceSide: 'C',
            BalanceType: 'B',
            Type: 22,
            TypeDescription: 'Accounts payable',
            IsBlocked: false,
            VATCode: '4',
          },
          {
            ID: guid(3),
            Code: '8000',
            Description: 'Omzet',
            BalanceSide: 'C',
            BalanceType: 'W',
            Type: 110,
            TypeDescription: 'Revenue',
            IsBlocked: false,
            VATCode: '1',
          },
          {
            ID: guid(4),
            Code: '4400',
            Description: 'Inkoop EU',
            BalanceSide: 'D',
            BalanceType: 'W',
            Type: 121,
            TypeDescription: 'SG&A',
            IsBlocked: false,
            VATCode: '7',
          },
          {
            ID: guid(5),
            Code: '4410',
            Description: 'Vrachtkosten EU',
            BalanceSide: 'D',
            BalanceType: 'W',
            Type: 121,
            TypeDescription: 'SG&A',
            IsBlocked: false,
            VATCode: '7',
          },
          {
            ID: guid(6),
            Code: '8300',
            Description: 'Omzet export',
            BalanceSide: 'C',
            BalanceType: 'W',
            Type: 110,
            TypeDescription: 'Revenue',
            IsBlocked: false,
            VATCode: '12',
          },
        ]),
      )
      return
    }

    if (path.includes('vat/VATCodes')) {
      send(
        200,
        collection([
          {
            Code: '1',
            Description: 'BTW hoog verkoop 21%',
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'S',
            IsBlocked: false,
            Charged: false,
          },
          {
            Code: '2',
            Description: 'BTW laag verkoop 9%',
            Percentage: 0.09,
            Type: 'E',
            VATTransactionType: 'S',
            IsBlocked: false,
            Charged: false,
          },
          {
            Code: '4',
            Description: 'BTW hoog inkoop 21%',
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'P',
            IsBlocked: false,
            Charged: false,
          },
          {
            Code: '5',
            Description: 'BTW laag inkoop 9%',
            Percentage: 0.09,
            Type: 'E',
            VATTransactionType: 'P',
            IsBlocked: false,
            Charged: false,
          },
          {
            Code: '0',
            Description: 'Geen BTW',
            Percentage: 0,
            Type: 'N',
            VATTransactionType: 'B',
            IsBlocked: false,
            Charged: false,
          },
          {
            Code: '7',
            Description: 'Verlegd inkoop EU',
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'P',
            IsBlocked: false,
            Charged: true,
          },
          {
            Code: '12',
            Description: 'Verkoop 0% buiten EU',
            Percentage: 0,
            Type: 'E',
            VATTransactionType: 'S',
            IsBlocked: false,
            Charged: false,
          },
        ]),
      )
      return
    }

    if (path.includes('cashflow/PaymentConditions')) {
      send(
        200,
        collection([
          { Code: '30', Description: '30 dagen', PaymentDays: 30, PaymentEndOfMonths: 0 },
        ]),
      )
      return
    }

    if (path.includes('financial/ReportingBalance')) {
      send(
        200,
        collection([
          {
            GLAccountCode: '1300',
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
            GLAccountCode: '8000',
            BalanceType: 'W',
            AmountDebit: 0,
            AmountCredit: 1210,
            Amount: -1210,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 50,
          },
          {
            GLAccountCode: '1600',
            BalanceType: 'B',
            AmountDebit: 0,
            AmountCredit: 605,
            Amount: -605,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 20,
          },
          {
            GLAccountCode: '4400',
            BalanceType: 'W',
            AmountDebit: 605,
            AmountCredit: 0,
            Amount: 605,
            Count: 1,
            ReportingYear: 2026,
            ReportingPeriod: 1,
            Status: 20,
          },
        ]),
      )
      return
    }

    if (path.includes('bulk/CRM/Accounts')) {
      send(
        200,
        collection([
          {
            ID: guid(101),
            Code: padded('1000'),
            Name: 'Klant Een BV',
            Type: 'A',
            Status: 'C',
            IsSales: true,
            IsSupplier: false,
            Blocked: false,
            VATNumber: null,
            Country: 'NL',
            Email: 'klant@example.nl',
            Phone: null,
            PaymentConditionSales: '30',
            PaymentConditionPurchase: null,
          },
          {
            ID: guid(102),
            Code: padded('2000'),
            Name: 'Leverancier Twee BV',
            Type: 'A',
            Status: 'C',
            IsSales: false,
            IsSupplier: true,
            Blocked: false,
            VATNumber: null,
            Country: 'NL',
            Email: 'inkoop@example.nl',
            Phone: null,
            PaymentConditionSales: null,
            PaymentConditionPurchase: '30',
          },
        ]),
      )
      return
    }

    if (path.includes('Receivables') || path.includes('Payables')) {
      send(200, collection([]))
      return
    }

    if (path.includes('UserHasRights')) {
      send(200, collection([{ UserHasRights: true }]))
      return
    }

    send(404, JSON.stringify({ error: { message: { value: `no stand-in for ${path}` } } }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${String(address.port)}`

  return {
    baseUrl,
    clientId,
    clientSecret,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
