import { describe, expect, it } from 'vitest'
import {
  parseGLAccount,
  parseOpenItem,
  parseReportingBalance,
  planExactImport,
  type ExactImportOptions,
} from '../../src/index.js'
import { RAW, snapshot } from './fixture.js'

/**
 * What importing an Exact division would do, before it does it.
 *
 * The reconciliation is the part worth testing hardest, because it is the only
 * thing standing between "the import ran" and "the books are right". Spec 13
 * asks for "a reconciliation report against the source system's trial balance
 * before anything is committed", and the three questions it answers are: does
 * Exact's own trial balance balance, do the open items add up to the control
 * accounts, and does every account with a balance exist in the chart.
 */

const options = (overrides: Partial<ExactImportOptions> = {}): ExactImportOptions => ({
  entityId: 'entity-1',
  currency: 'EUR',
  existingAccountNumbers: [],
  existingContactNumbers: [],
  existingTaxCodes: ['H', 'H1'],
  ...overrides,
})

describe('the chart of accounts', () => {
  it('maps Exact types onto ours', () => {
    const plan = planExactImport(snapshot(), options())
    const byNumber = new Map(plan.accounts.map((account) => [account.number, account]))

    expect(byNumber.get('1100')).toMatchObject({ type: 'asset', normalBalance: 'debit' })
    expect(byNumber.get('1300')).toMatchObject({ type: 'asset', normalBalance: 'debit' })
    expect(byNumber.get('1600')).toMatchObject({ type: 'liability', normalBalance: 'credit' })
    expect(byNumber.get('8000')).toMatchObject({ type: 'revenue', normalBalance: 'credit' })
    expect(byNumber.get('4000')).toMatchObject({ type: 'expense', normalBalance: 'debit' })
  })

  it('calls capital stock equity rather than a liability', () => {
    // The case the BalanceType/BalanceSide fallback cannot get right on its
    // own: a balance-sheet credit account that is not a liability.
    const plan = planExactImport(snapshot(), options())
    const equity = plan.accounts.find((account) => account.number === '0500')
    expect(equity).toMatchObject({ type: 'equity', normalBalance: 'credit', derived: false })
  })

  it('falls back to the balance type and warns when Exact type 90 says nothing', () => {
    // 90 is "General", which does not say which side it lands on.
    const general = parseGLAccount({
      ID: RAW.guid(50),
      Code: '9999',
      Description: 'Tussenrekening',
      BalanceSide: 'D',
      BalanceType: 'B',
      Type: 90,
      TypeDescription: 'General',
      IsBlocked: false,
      VATCode: null,
      ReportingCode: null,
    })

    const plan = planExactImport(
      snapshot({ glAccounts: [...snapshot().glAccounts, general] }),
      options(),
    )

    const account = plan.accounts.find((entry) => entry.number === '9999')
    expect(account).toMatchObject({ type: 'asset', normalBalance: 'debit', derived: true })
    expect(plan.warnings.map((warning) => warning.code)).toContain('derived_account_type')
  })

  it('says which accounts already exist here rather than proposing them again', () => {
    const plan = planExactImport(snapshot(), options({ existingAccountNumbers: ['1300', '1600'] }))
    expect(plan.accounts.filter((account) => account.exists).map((a) => a.number)).toEqual([
      '1300',
      '1600',
    ])
  })

  it('drops a default VAT code this administration does not have, and says so', () => {
    const plan = planExactImport(snapshot(), options({ existingTaxCodes: [] }))
    const revenue = plan.accounts.find((account) => account.number === '8000')

    expect(revenue?.defaultTaxCode).toBeNull()
    expect(plan.warnings.filter((warning) => warning.code === 'unknown_tax_code')).not.toHaveLength(
      0,
    )
  })
})

describe('contacts', () => {
  it('imports relations and skips the division that appears among them', () => {
    // A `Type: 'D'` account is one of the user's own divisions. Importing it
    // would create a contact for the company itself.
    const plan = planExactImport(snapshot(), options())
    expect(plan.contacts.map((contact) => contact.number).sort()).toEqual(['1000', '2000'])
  })

  it('trims the eighteen-character padding off the relation code', () => {
    const plan = planExactImport(snapshot(), options())
    expect(plan.contacts.map((contact) => contact.number)).not.toContain(RAW.padded('1000'))
  })

  it('reads the roles from Exact and from the open items both', () => {
    const plan = planExactImport(snapshot(), options())
    const customer = plan.contacts.find((contact) => contact.number === '1000')
    const supplier = plan.contacts.find((contact) => contact.number === '2000')

    expect(customer).toMatchObject({ isCustomer: true, isSupplier: false })
    expect(supplier).toMatchObject({ isCustomer: false, isSupplier: true })
  })

  it('makes a relation with an open receivable a customer whatever its status says', () => {
    // A prospect Exact does not call a customer but which owes money has to be
    // a customer here, or the open item has nowhere to land.
    const base = snapshot()
    const demoted = base.accounts.map((account) =>
      account.code === '1000' ? { ...account, status: 'P', isSales: false } : account,
    )

    const plan = planExactImport(snapshot({ accounts: demoted }), options())

    expect(plan.contacts.find((contact) => contact.number === '1000')?.isCustomer).toBe(true)
  })

  it('takes the payment term from the condition and reports one it cannot express', () => {
    const plan = planExactImport(snapshot(), options())
    expect(plan.contacts.find((contact) => contact.number === '1000')?.paymentTermsDays).toBe(30)

    // "End of month plus fourteen days" is not a number of days. Imported as
    // fourteen, and said out loud, because every due date will differ.
    expect(plan.contacts.find((contact) => contact.number === '2000')?.paymentTermsDays).toBe(14)
    expect(plan.warnings.map((warning) => warning.code)).toContain('payment_term_not_representable')
  })

  it('creates a contact from an open item whose relation Exact did not return', () => {
    const orphan = parseOpenItem({
      ...RAW.receivables[0]!,
      HID: 900999,
      AccountId: RAW.guid(199),
      AccountCode: RAW.padded('7777'),
      AccountName: 'Verdwenen Klant BV',
      Amount: 100,
    })

    const base = snapshot()
    const plan = planExactImport(
      snapshot({ receivables: [...base.receivables, orphan] }),
      options(),
    )

    const created = plan.contacts.find((contact) => contact.number === '7777')
    expect(created).toMatchObject({ name: 'Verdwenen Klant BV', isCustomer: true })
  })
})

describe('open items', () => {
  it('preserves the number the invoice carries in Exact', () => {
    // Dunning and matching are conversations with somebody looking at the old
    // number (spec 13).
    const plan = planExactImport(snapshot(), options())
    expect(plan.openItems.map((item) => item.documentNumber).sort()).toEqual([
      '20260001',
      '20260002',
      '700045',
    ])
  })

  it('keeps the counterparty reference, which on a purchase item is their number', () => {
    const plan = planExactImport(snapshot(), options())
    const payable = plan.openItems.find((item) => item.side === 'payable')
    expect(payable?.theirReference).toBe('LEV-2026-88')
  })

  it('refuses an open item in another currency rather than converting it', () => {
    const foreign = parseOpenItem({ ...RAW.receivables[0]!, HID: 900500, CurrencyCode: 'USD' })
    const base = snapshot()
    const plan = planExactImport(
      snapshot({ receivables: [...base.receivables, foreign] }),
      options(),
    )

    expect(plan.problems.map((problem) => problem.code)).toContain('unknown_currency')
    expect(plan.openItems).toHaveLength(3)
  })
})

describe('the reconciliation', () => {
  it('agrees with a division whose books are in order', () => {
    const plan = planExactImport(snapshot(), options())
    const { reconciliation } = plan

    expect(reconciliation.balanced).toBe(true)
    expect(reconciliation.totalDebit).toBe(363_000n)
    expect(reconciliation.totalCredit).toBe(363_000n)
    expect(reconciliation.receivable).toMatchObject({
      accountCodes: ['1300'],
      ledger: 302_500n,
      openItems: 302_500n,
      difference: 0n,
      outcome: 'matches',
      itemCount: 2,
    })
    expect(reconciliation.payable).toMatchObject({
      accountCodes: ['1600'],
      ledger: 60_500n,
      openItems: 60_500n,
      outcome: 'matches',
    })
    expect(plan.problems).toEqual([])
  })

  it('sums every period of the year, including the unprocessed one', () => {
    // `ReportingBalance` is per period, and `Status: 20` rows are entered but
    // not processed. Reading only period one, or only processed rows, would
    // understate 1300 by 1 815,00 and report a difference that is ours.
    const plan = planExactImport(snapshot(), options())
    expect(plan.reconciliation.receivable.ledger).toBe(302_500n)
  })

  it('refuses to import when Exact’s own trial balance does not balance', () => {
    const broken = (snapshot().trialBalance ?? []).filter((row) => row.accountCode !== '8000')
    const plan = planExactImport(snapshot({ trialBalance: broken }), options())

    expect(plan.reconciliation.balanced).toBe(false)
    expect(plan.problems.map((problem) => problem.code)).toContain('trial_balance_unbalanced')
  })

  it('reports the difference when the open items do not add up to the control account', () => {
    // Something booked straight to 1300 without an open item behind it. The
    // import would start the debtors ledger short by the difference, and the
    // only place that is visible is here.
    const extra = parseReportingBalance({
      GLAccountCode: '1300',
      GLAccountDescription: 'Debiteuren',
      BalanceType: 'B',
      AmountDebit: 250,
      AmountCredit: 0,
      Amount: 250,
      Count: 1,
      ReportingYear: 2026,
      ReportingPeriod: 3,
      Status: 50,
    })
    const balancing = parseReportingBalance({
      GLAccountCode: '8000',
      GLAccountDescription: 'Omzet',
      BalanceType: 'W',
      AmountDebit: 0,
      AmountCredit: 250,
      Amount: -250,
      Count: 1,
      ReportingYear: 2026,
      ReportingPeriod: 3,
      Status: 50,
    })

    const plan = planExactImport(
      snapshot({ trialBalance: [...(snapshot().trialBalance ?? []), extra, balancing] }),
      options(),
    )

    expect(plan.reconciliation.balanced).toBe(true)
    expect(plan.reconciliation.receivable).toMatchObject({
      ledger: 327_500n,
      openItems: 302_500n,
      difference: -25_000n,
      outcome: 'differs',
    })
    // A warning rather than a refusal: a twelve-year-old administration often
    // has a known and explicable difference, and refusing would make the tool
    // useless. What it must not do is fail to mention it.
    expect(plan.warnings.map((warning) => warning.code)).toContain('open_items_do_not_reconcile')
    expect(plan.problems).toEqual([])
  })

  it('measures creditors in their own direction', () => {
    // 1600 is a credit balance. Comparing signed totals would make a correct
    // creditors position look like a difference of twice its value.
    const plan = planExactImport(snapshot(), options())
    expect(plan.reconciliation.payable.difference).toBe(0n)
  })

  it('names an account with a balance and no place in the chart', () => {
    const orphan = parseReportingBalance({
      GLAccountCode: '4999',
      GLAccountDescription: 'Verdwenen kosten',
      BalanceType: 'W',
      AmountDebit: 100,
      AmountCredit: 0,
      Amount: 100,
      Count: 1,
      ReportingYear: 2026,
      ReportingPeriod: 1,
      Status: 50,
    })
    const balancing = parseReportingBalance({
      GLAccountCode: '8000',
      GLAccountDescription: 'Omzet',
      BalanceType: 'W',
      AmountDebit: 0,
      AmountCredit: 100,
      Amount: -100,
      Count: 1,
      ReportingYear: 2026,
      ReportingPeriod: 1,
      Status: 50,
    })

    const plan = planExactImport(
      snapshot({ trialBalance: [...(snapshot().trialBalance ?? []), orphan, balancing] }),
      options(),
    )

    expect(plan.reconciliation.orphanAccountCodes).toEqual(['4999'])
    expect(plan.warnings.map((warning) => warning.code)).toContain('trial_balance_account_missing')
  })

  it('says when there is no control account to reconcile against', () => {
    const withoutControls = snapshot().glAccounts.filter(
      (account) => account.code !== '1300' && account.code !== '1600',
    )
    const plan = planExactImport(snapshot({ glAccounts: withoutControls }), options())

    expect(plan.reconciliation.receivable.accountCodes).toEqual([])
    expect(plan.warnings.filter((warning) => warning.code === 'no_control_account')).toHaveLength(2)
  })

  it('accepts control accounts named by the caller, for a chart that types them as general', () => {
    const plan = planExactImport(
      snapshot(),
      options({ receivableAccountCodes: ['1300'], payableAccountCodes: ['1600'] }),
    )
    expect(plan.reconciliation.receivable.outcome).toBe('matches')
  })
})

describe('the whole administration', () => {
  it('refuses a division kept in another currency', () => {
    const plan = planExactImport(
      snapshot({ division: { ...snapshot().division, currency: 'GBP' } }),
      options(),
    )
    expect(plan.problems.map((problem) => problem.code)).toContain('unknown_currency')
  })

  it('says so when Exact did not name the division’s currency, rather than assuming', () => {
    // The open items carry their own currency, but `ReportingBalance` has no
    // currency column — so an unstated one means the whole trial balance is
    // being read on an assumption.
    const plan = planExactImport(
      snapshot({ division: { ...snapshot().division, currency: null } }),
      options(),
    )

    expect(plan.warnings.map((warning) => warning.code)).toContain('unknown_currency')
    expect(plan.problems).toEqual([])
  })

  it('warns rather than refuses when the chosen division is a practice one', () => {
    // An accountant restoring an archived year means it. It has to be in the
    // report, not in the way.
    const plan = planExactImport(
      snapshot({ division: { ...snapshot().division, isPracticeDivision: true } }),
      options(),
    )

    expect(plan.warnings.map((warning) => warning.code)).toContain('division_caution')
    expect(plan.problems).toEqual([])
  })

  it('leaves out a blocked VAT code and keeps the rest with their percentages', () => {
    const plan = planExactImport(snapshot(), options())
    expect(plan.taxCodes.map((code) => code.code)).toEqual(['H', 'H1'])
    expect(plan.taxCodes[0]).toMatchObject({ percentage: '21', appliesTo: 'sales', mapped: true })
  })

  it('groups attachments under their document and reports one with no URL', () => {
    const plan = planExactImport(snapshot(), options())
    const [document] = plan.documents

    expect(document?.attachments.map((attachment) => attachment.fileName)).toEqual([
      'inkoopfactuur.pdf',
    ])
    expect(plan.warnings.map((warning) => warning.code)).toContain('attachment_without_url')
  })

  it('reads a /Date(ms)/ document date', () => {
    const plan = planExactImport(snapshot(), options())
    expect(plan.documents[0]?.documentDate).toBe('2026-01-31')
  })
})

describe('a resource Exact refuses', () => {
  // The case a real connection hit: `financial/ReportingBalance` answered 403
  // while `vat/VATCodes` — the same documented scope — answered 200. Exact
  // grants rights per resource, so this is not an all-or-nothing failure and
  // must not be treated as one.
  const refused = (resource: string, status = 403) => ({
    unreadable: [{ resource, status, message: `Exact Online answered ${String(status)}` }],
  })

  it('does not report an unread trial balance as a balanced one', () => {
    // The trap this whole shape exists for. An empty trial balance has debit
    // equal to credit, so a naive degradation reports a division as reconciled
    // without having looked at it.
    const plan = planExactImport(
      snapshot({ trialBalance: null, ...refused('financial/ReportingBalance') }),
      options(),
    )

    expect(plan.reconciliation.available).toBe(false)
    expect(plan.reconciliation.balanced).toBeNull()
    expect(plan.reconciliation.totalDebit).toBeNull()
    expect(plan.problems.map((problem) => problem.code)).not.toContain('trial_balance_unbalanced')
  })

  it('does not report the open items as a difference against a control account of zero', () => {
    // The second half of the same trap, and the more damaging one: it would
    // accuse somebody's administration of having postings on 1300 with no open
    // item behind them, when all that happened is that we could not read it.
    const plan = planExactImport(
      snapshot({ trialBalance: null, ...refused('financial/ReportingBalance') }),
      options(),
    )

    expect(plan.reconciliation.receivable.outcome).toBe('not_reconciled')
    expect(plan.reconciliation.receivable.ledger).toBeNull()
    expect(plan.reconciliation.receivable.difference).toBeNull()
    // The open items are still counted: they came from a resource that answered.
    expect(plan.reconciliation.receivable.openItems).toBe(302_500n)
    expect(plan.warnings.map((warning) => warning.code)).not.toContain(
      'open_items_do_not_reconcile',
    )
  })

  it('still imports everything else, and says what the missing report cost', () => {
    const plan = planExactImport(
      snapshot({ trialBalance: null, ...refused('financial/ReportingBalance') }),
      options(),
    )

    // The import itself is unaffected — the trial balance was never a source of
    // rows, only of proof.
    expect(plan.accounts.length).toBeGreaterThan(0)
    expect(plan.contacts.length).toBeGreaterThan(0)
    expect(plan.openItems.length).toBeGreaterThan(0)
    expect(plan.problems).toEqual([])

    const warning = plan.warnings.find((candidate) => candidate.code === 'resource_unreadable')
    expect(warning?.message).toContain('financial/ReportingBalance')
    expect(warning?.message).toContain('403')
    // A 403 is a rights problem, and the report has to say whose.
    expect(warning?.message).toContain('rights')
    expect(warning?.message).toContain('not proved complete')
  })

  it('refuses when a resource the import actually needs is missing', () => {
    // Losing the chart of accounts is not a degradation, it is the import.
    const plan = planExactImport(
      snapshot({ glAccounts: [], ...refused('financial/GLAccounts') }),
      options(),
    )

    const problem = plan.problems.find((candidate) => candidate.code === 'resource_unreadable')
    expect(problem?.message).toContain('The import needs it.')
  })

  it('degrades quietly for reference data, naming what each loss costs', () => {
    const plan = planExactImport(
      snapshot({
        vatCodes: [],
        paymentConditions: [],
        unreadable: [
          { resource: 'vat/VATCodes', status: 403, message: '403' },
          { resource: 'cashflow/PaymentConditions', status: 403, message: '403' },
        ],
      }),
      options(),
    )

    expect(plan.problems).toEqual([])
    const messages = plan.warnings
      .filter((warning) => warning.code === 'resource_unreadable')
      .map((warning) => warning.message)
      .join(' ')
    expect(messages).toContain('without their default VAT code')
    expect(messages).toContain('due dates will differ')
  })

  it('says 404 differently from 403, because it is not about rights', () => {
    const plan = planExactImport(
      snapshot({ trialBalance: null, ...refused('financial/ReportingBalance', 404) }),
      options(),
    )

    const warning = plan.warnings.find((candidate) => candidate.code === 'resource_unreadable')
    expect(warning?.message).toContain('404')
    expect(warning?.message).not.toContain('rights')
  })
})
