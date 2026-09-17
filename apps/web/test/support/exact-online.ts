/**
 * A fake Exact Online, shared by the suites that need one.
 *
 * `globalThis.fetch` is replaced rather than a client injected, so the handlers
 * run exactly as they do in production — including the token rotation, which
 * is the part with a hazard in it. What this returns is shaped the way Exact's
 * own reference documentation says its rows are shaped: `{ d: { results: [] } }`,
 * `Edm.Double` amounts, relation codes padded to eighteen characters.
 *
 * Here rather than in one test file because two suites need it: exact.test.ts
 * for the behaviour, response-shapes.test.ts so that the eight Exact
 * operations are not the only ones in the API whose published response nobody
 * checks. A second copy would drift from Exact's shapes independently, which
 * is the one thing this file exists to be right about.
 */

const padded = (code: string): string => code.padStart(18, ' ')
const guid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

export interface FakeExact {
  /** Every URL asked, in order. */
  readonly asked: string[]
  /** Token pairs handed out, oldest first. */
  readonly issued: { accessToken: string; refreshToken: string }[]
  /** Refresh tokens that have been spent, and are therefore dead. */
  readonly spent: Set<string>
  divisions: readonly Record<string, unknown>[]
  /** Set to make the next refresh fail the way a revoked app does. */
  revoked: boolean
  /**
   * Resources to answer 403 for, by path fragment.
   *
   * Exact grants rights per resource, so a division can answer 200 for six
   * things and 403 for the seventh. This is how that is reproduced.
   */
  forbidden: Set<string>
  /** Return a chart-of-accounts row the reader cannot make sense of. */
  malformed: boolean
  /** Answer with a division kept in another currency, which blocks an import. */
  otherCurrency: boolean
}

export function fakeExact(): FakeExact {
  const state: FakeExact = {
    asked: [],
    issued: [],
    spent: new Set(),
    revoked: false,
    forbidden: new Set(),
    malformed: false,
    otherCurrency: false,
    divisions: [
      {
        Code: 1000,
        Description: 'Voorbeeld BV',
        Currency: 'EUR',
        Country: 'NL',
        Status: 1,
        IsMainDivision: true,
        Current: true,
      },
      {
        Code: 2000,
        Description: 'Aardig Testje',
        Currency: 'EUR',
        Country: 'NL',
        Status: 1,
        IsPracticeDivision: true,
      },
      { Code: 3000, Description: 'Oude Holding BV', Currency: 'EUR', Country: 'NL', Status: 2 },
    ],
  }

  let issued = 0
  const nextPair = () => {
    issued += 1
    const pair = {
      accessToken: `access-${String(issued)}`,
      refreshToken: `refresh-${String(issued)}`,
    }
    state.issued.push(pair)
    return pair
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  const collection = (rows: readonly unknown[]): Response => json({ d: { results: rows } })

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    state.asked.push(url)

    if (url.includes('/api/oauth2/token')) {
      // Every caller here posts a form as a string; anything else is a bug in
      // the caller rather than something to stringify hopefully.
      const sent = typeof init?.body === 'string' ? init.body : ''
      const body = new URLSearchParams(sent)

      if (body.get('grant_type') === 'refresh_token') {
        const offered = body.get('refresh_token') ?? ''
        if (state.revoked || state.spent.has(offered)) {
          // Exact's own answer to a spent or revoked token.
          return Promise.resolve(
            json({ error: 'invalid_grant', error_description: 'Token is no longer valid' }, 400),
          )
        }
        state.spent.add(offered)
      }

      const pair = nextPair()
      return Promise.resolve(
        json({
          access_token: pair.accessToken,
          refresh_token: pair.refreshToken,
          // A string, because both forms have to work.
          expires_in: '600',
          token_type: 'bearer',
        }),
      )
    }

    // Everything below needs the current access token.
    const authorization = new Headers(init?.headers).get('authorization') ?? ''
    const current = state.issued[state.issued.length - 1]
    if (current === undefined || authorization !== `Bearer ${current.accessToken}`) {
      return Promise.resolve(new Response('unauthorised', { status: 401 }))
    }

    if (url.includes('current/Me')) {
      return Promise.resolve(
        collection([{ UserID: guid(9), FullName: 'H. Stokvis', CurrentDivision: 1000 }]),
      )
    }
    if (url.includes('system/Divisions')) {
      return Promise.resolve(
        collection(
          state.otherCurrency
            ? state.divisions.map((division) => ({ ...division, Currency: 'GBP' }))
            : state.divisions,
        ),
      )
    }

    // Exact's own 403 body, verbatim.
    for (const path of state.forbidden) {
      if (url.includes(path)) {
        return Promise.resolve(
          json({ error: { code: '', message: { lang: '', value: 'Forbidden' } } }, 403),
        )
      }
    }

    if (url.includes('bulk/Financial/GLAccounts')) {
      if (state.malformed) {
        return Promise.resolve(collection([{ ID: 'nonsense', Code: '1300' }]))
      }
      return Promise.resolve(
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
          },
          {
            ID: guid(5),
            Code: '2000',
            Description: 'Tussenrekening',
            BalanceSide: 'D',
            BalanceType: 'B',
            Type: 90,
            TypeDescription: 'General',
            IsBlocked: false,
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
          },
          {
            ID: guid(4),
            Code: '4000',
            Description: 'Kantoorkosten',
            BalanceSide: 'D',
            BalanceType: 'W',
            Type: 121,
            TypeDescription: 'SG&A',
            IsBlocked: false,
          },
        ]),
      )
    }
    if (url.includes('vat/VATCodes')) {
      return Promise.resolve(
        collection([
          {
            Code: 'H',
            Description: 'BTW hoog',
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'B',
            IsBlocked: false,
          },
        ]),
      )
    }
    if (url.includes('cashflow/PaymentConditions')) {
      return Promise.resolve(
        collection([
          { Code: '30', Description: '30 dagen', PaymentDays: 30, PaymentEndOfMonths: 0 },
        ]),
      )
    }
    if (url.includes('financial/ReportingBalance')) {
      // 1 210,00 receivable, 605,00 payable, and 1 815,00 each way.
      return Promise.resolve(
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
            GLAccountCode: '4000',
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
    }
    if (url.includes('bulk/CRM/Accounts')) {
      return Promise.resolve(
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
            Country: 'NL',
            City: 'Amsterdam',
            PaymentConditionSales: '30',
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
            Country: 'NL',
            City: 'Rotterdam',
          },
        ]),
      )
    }
    if (url.includes('ReceivablesList')) {
      return Promise.resolve(
        collection([
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
        ]),
      )
    }
    if (url.includes('PayablesList')) {
      return Promise.resolve(
        collection([
          {
            HID: 900101,
            AccountId: guid(102),
            AccountCode: padded('2000'),
            AccountName: 'Leverancier Twee BV',
            Amount: 605,
            AmountInTransit: 0,
            CurrencyCode: 'EUR',
            Description: 'Inkoop',
            DueDate: '2026-02-28T00:00:00',
            InvoiceDate: '2026-01-29T00:00:00',
            InvoiceNumber: 700045,
            EntryNumber: 700045,
            JournalCode: '80',
            YourRef: 'LEV-88',
          },
        ]),
      )
    }

    return Promise.resolve(collection([]))
  }

  return state
}
