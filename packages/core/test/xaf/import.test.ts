import { describe, expect, it } from 'vitest'
import { generateXaf } from '../../src/xaf/generate.js'
import { planXafImport } from '../../src/xaf/import.js'
import { XafParseError, parseXaf, parseXafAmount, parseXml } from '../../src/xaf/parse.js'
import { referenceDocument } from './fixture.js'

const options = {
  entityId: 'entity-1',
  existingAccountNumbers: ['1100', '1300'],
  existingJournalCodes: ['VRK'],
  // The fixture's only tax code. Without it the plan refuses, which is the
  // point — see 'what the file uses' below.
  existingTaxCodes: ['H21'],
  existingDimensionValues: ['COSTCENTRE|ALG', 'PROJECT|PRJ-01'],
  contactIdsByNumber: new Map([
    ['DEB-0001', '11111111-1111-4111-8111-111111111111'],
    ['CRE-0001', '22222222-2222-4222-8222-222222222222'],
  ]),
  acceptFrom: null,
  acceptTo: null,
}

describe('the XML reader', () => {
  it('handles namespace prefixes, self-closing tags and entities', () => {
    const root = parseXml(
      `<?xml version="1.0"?><x:auditfile xmlns:x="urn:test"><x:a>A &amp; B</x:a><x:b/></x:auditfile>`,
    )
    expect(root.name).toBe('auditfile')
    expect(root.children.map((child) => child.name)).toEqual(['a', 'b'])
    expect(root.children[0]?.text).toBe('A & B')
  })

  it('unwraps CDATA', () => {
    const root = parseXml('<a><b><![CDATA[<not a tag>]]></b></a>')
    expect(root.children[0]?.text).toBe('<not a tag>')
  })

  it('refuses a DOCTYPE', () => {
    // An auditfile arrives from outside. A parser that resolves external
    // entities is a file-disclosure vulnerability, so the declaration that
    // enables them is refused outright.
    expect(() =>
      parseXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>'),
    ).toThrow(XafParseError)
  })

  it('refuses mismatched tags', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow(XafParseError)
  })
})

describe('amount parsing', () => {
  it('reads decimals into minor units without a float', () => {
    expect(parseXafAmount('1234.56', 'x')).toBe(123_456n)
    expect(parseXafAmount('0.05', 'x')).toBe(5n)
    expect(parseXafAmount('-1234.56', 'x')).toBe(-123_456n)
    expect(parseXafAmount('1234', 'x')).toBe(123_400n)
    expect(parseXafAmount('1234.5', 'x')).toBe(123_450n)
  })

  it('survives amounts a float would round', () => {
    expect(parseXafAmount('92233720368547758.07', 'x')).toBe(9_223_372_036_854_775_807n)
  })

  it('rejects anything that is not an amount', () => {
    for (const bad of ['1.234', '1,00', '1e3', '', 'abc', '1.2.3']) {
      expect(() => parseXafAmount(bad, 'x'), bad).toThrow(XafParseError)
    }
  })
})

describe('importing our own export', () => {
  const xml = generateXaf(referenceDocument())

  it('reconciles against the file’s own control totals', () => {
    const plan = planXafImport(xml, options)

    expect(plan.reconciliation.matches).toBe(true)
    expect(plan.reconciliation.declaredLineCount).toBe(plan.reconciliation.actualLineCount)
    expect(plan.reconciliation.actualTotalDebit).toBe(plan.reconciliation.actualTotalCredit)
    expect(plan.problems).toEqual([])
  })

  it('plans the chart, saying what already exists', () => {
    const plan = planXafImport(xml, options)

    expect(plan.accounts).toHaveLength(7)
    expect(plan.accounts.find((account) => account.number === '1100')?.exists).toBe(true)
    expect(plan.accounts.find((account) => account.number === '0500')?.exists).toBe(false)
  })

  it('infers account types from the RGS lead code', () => {
    const plan = planXafImport(xml, options)
    const byNumber = new Map(plan.accounts.map((account) => [account.number, account]))

    expect(byNumber.get('0500')?.type).toBe('equity')
    expect(byNumber.get('1600')?.type).toBe('liability')
    expect(byNumber.get('1300')?.type).toBe('asset')
    expect(byNumber.get('8000')?.type).toBe('revenue')
    expect(byNumber.get('4000')?.type).toBe('expense')
  })

  it('plans the journals with their Dutch types', () => {
    const plan = planXafImport(xml, options)
    const byCode = new Map(plan.journals.map((journal) => [journal.code, journal]))

    expect(byCode.get('VRK')?.type).toBe('verkoop')
    expect(byCode.get('INK')?.type).toBe('inkoop')
    expect(byCode.get('BNK')?.type).toBe('bank')
    expect(byCode.get('MEM')?.type).toBe('memoriaal')
    expect(byCode.get('VRK')?.exists).toBe(true)
  })

  it('produces balanced postable entries, keeping the original numbering', () => {
    const plan = planXafImport(xml, options)

    expect(plan.entries).toHaveLength(4)
    for (const entry of plan.entries) {
      const net = entry.lines.reduce((total, line) => total + line.debit - line.credit, 0n)
      expect(net, entry.description).toBe(0n)
    }

    const sale = plan.entries.find((entry) => entry.journalCode === 'VRK')
    expect(sale?.sourceDocumentRef).toBe('VRK-2026-001')
    expect(sale?.lines).toHaveLength(3)
  })

  it('keeps the foreign-currency original as evidence, not as a made-up rate', () => {
    const plan = planXafImport(xml, options)
    const purchase = plan.entries.find((entry) => entry.journalCode === 'INK')

    // XAF gives the original amount but not the rate. Dividing to recover one
    // would put a computed figure into a permanent record.
    expect(purchase?.lines[0]?.exchangeRate).toBeNull()
    expect(purchase?.lines[0]?.description).toContain('USD 50000 minor units')
    expect(purchase?.lines[0]?.debit).toBe(460_00n)
  })

  it('respects a date range, and says what it skipped', () => {
    const plan = planXafImport(xml, {
      ...options,
      acceptFrom: '2026-03-01',
      acceptTo: '2026-03-31',
    })

    expect(plan.entries).toHaveLength(2)
    expect(plan.warnings.filter((warning) => warning.includes('Skipped'))).toHaveLength(2)
  })
})

describe('importing a file from somewhere else', () => {
  /**
   * Shaped like what other Dutch packages emit: no namespace, CRLF, elements
   * we do not write, a journal type we do not use, and an account with no RGS
   * code. None of that is a reason to refuse somebody's migration.
   */
  const foreign = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<auditfile>',
    '  <header>',
    '    <fiscalYear>2025</fiscalYear>',
    '    <startDate>2025-01-01</startDate>',
    '    <endDate>2025-12-31</endDate>',
    '    <curCode>EUR</curCode>',
    '    <dateCreated>2026-01-05</dateCreated>',
    '    <softwareDesc>Some Other Package</softwareDesc>',
    '  </header>',
    '  <company>',
    '    <companyName>Oude Administratie B.V.</companyName>',
    '    <taxRegistrationCountry>NL</taxRegistrationCountry>',
    '    <taxRegIdent>NL001234567B01</taxRegIdent>',
    '    <generalLedger>',
    '      <ledgerAccount><accID>1000</accID><accDesc>Kas</accDesc><accTp>B</accTp></ledgerAccount>',
    '      <ledgerAccount><accID>8000</accID><accDesc>Omzet</accDesc><accTp>P</accTp></ledgerAccount>',
    '    </generalLedger>',
    '    <periods>',
    '      <period><periodNumber>6</periodNumber><startDatePeriod>2025-06-01</startDatePeriod><endDatePeriod>2025-06-30</endDatePeriod></period>',
    '    </periods>',
    '    <transactions>',
    '      <linesCount>2</linesCount><totalDebit>100.00</totalDebit><totalCredit>100.00</totalCredit>',
    '      <journal>',
    '        <jrnID>V</jrnID><desc>Verkoop</desc><jrnTp>Y</jrnTp>',
    '        <transaction>',
    '          <nr>17</nr><desc>Contante verkoop</desc><periodNumber>6</periodNumber><trDt>2025-06-15</trDt>',
    '          <trLine><nr>1</nr><accID>1000</accID><docRef>K17</docRef><effDate>2025-06-15</effDate><amnt>100.00</amnt><amntTp>D</amntTp></trLine>',
    '          <trLine><nr>2</nr><accID>8000</accID><docRef>K17</docRef><effDate>2025-06-15</effDate><amnt>100.00</amnt><amntTp>C</amntTp></trLine>',
    '        </transaction>',
    '      </journal>',
    '    </transactions>',
    '  </company>',
    '</auditfile>',
  ].join('\r\n')

  it('reads it', () => {
    const plan = planXafImport(foreign, {
      ...options,
      existingAccountNumbers: [],
      existingJournalCodes: [],
    })

    expect(plan.companyName).toBe('Oude Administratie B.V.')
    expect(plan.fiscalYear).toBe('2025')
    expect(plan.reconciliation.matches).toBe(true)
    expect(plan.problems).toEqual([])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]?.lines[0]?.debit).toBe(100_00n)
  })

  it('maps an unrecognised journal type to memoriaal rather than refusing', () => {
    const plan = planXafImport(foreign, options)
    expect(plan.journals[0]?.type).toBe('memoriaal')
  })

  it('warns about every account whose type had to be guessed', () => {
    const plan = planXafImport(foreign, options)
    expect(plan.warnings.filter((warning) => warning.includes('guessed'))).toHaveLength(2)
    // Guessed, but plausibly: 8000 is revenue in the Dutch decimal convention.
    expect(plan.accounts.find((account) => account.number === '8000')?.type).toBe('revenue')
  })

  it('blocks on a file whose control totals do not match its contents', () => {
    const tampered = foreign.replace(
      '<totalDebit>100.00</totalDebit>',
      '<totalDebit>999.00</totalDebit>',
    )
    const plan = planXafImport(tampered, options)

    expect(plan.reconciliation.matches).toBe(false)
    expect(plan.problems.length).toBeGreaterThan(0)
    expect(plan.problems[0]?.message).toContain('control totals')
  })

  it('blocks on an unbalanced transaction', () => {
    const broken = foreign
      .replace('<amnt>100.00</amnt><amntTp>C</amntTp>', '<amnt>90.00</amnt><amntTp>C</amntTp>')
      .replace('<totalCredit>100.00</totalCredit>', '<totalCredit>90.00</totalCredit>')

    const plan = planXafImport(broken, options)
    expect(plan.problems.some((problem) => problem.message.includes('does not balance'))).toBe(true)
  })

  it('rejects a reference to an account the file does not declare', () => {
    const broken = foreign.replace(
      '<accID>8000</accID><docRef>K17</docRef>',
      '<accID>9999</accID><docRef>K17</docRef>',
    )
    const plan = planXafImport(broken, options)
    expect(plan.problems.some((problem) => problem.message.includes('unknown account 9999'))).toBe(
      true,
    )
  })
})

describe('parse rejects a structurally broken file', () => {
  it('needs an auditfile root', () => {
    expect(() => parseXaf('<notanauditfile/>')).toThrow(/Expected <auditfile>/)
  })

  it('needs a header', () => {
    expect(() => parseXaf('<auditfile><company/></auditfile>')).toThrow(/<header> is missing/)
  })
})

describe('what the file uses', () => {
  const xml = generateXaf(referenceDocument())

  /** Only the columns the plan is asked about, so a case reads in one line. */
  const planWith = (overrides: Partial<typeof options>) =>
    planXafImport(xml, { ...options, ...overrides })

  it('tags the base from the file and finds the VAT line itself', () => {
    // XAF marks only the taxable base: `<vat>` sits on the revenue line and the
    // VAT ledger line beside it carries nothing, correctly — marking both would
    // declare the same tax twice.
    //
    // But the aangifte needs both (vat/return.ts): the base fills rubriek 1a's
    // omzet and the tax line fills its btw. So the tax line is found by its
    // amount and side, which is what stops an imported year declaring turnover
    // and no tax.
    const plan = planWith({})
    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')

    const base = sale?.lines.find((line) => line.accountNumber === '8000')
    expect(base?.taxCode).toBe('H21')
    expect(base?.taxRole).toBe('base')
    expect(base?.taxAmount).toBe(210_00n)

    const vatLine = sale?.lines.find((line) => line.accountNumber === '1500')
    expect(vatLine?.taxCode).toBe('H21')
    expect(vatLine?.taxRole).toBe('tax')
    expect(vatLine?.taxAmount).toBe(210_00n)

    // And nothing else is tagged. The receivable is neither base nor tax.
    const receivable = sale?.lines.find((line) => line.accountNumber === '1300')
    expect(receivable?.taxCode).toBeNull()
    expect(receivable?.taxRole).toBeNull()
  })

  it('says so when it cannot find the VAT line, rather than guessing', () => {
    // A guess would put a number in a rubriek that nothing in the journal
    // supports, which is the one thing the reconciliation exists to prevent.
    const withoutVatLine = generateXaf(
      (() => {
        const document = referenceDocument()
        const sales = document.journals.find((journal) => journal.jrnID === 'VRK')!
        const transaction = sales.transactions[0]!
        return {
          ...document,
          journals: document.journals.map((journal) =>
            journal.jrnID !== 'VRK'
              ? journal
              : {
                  ...journal,
                  transactions: [
                    {
                      ...transaction,
                      // The VAT line's amount changed, so nothing matches the
                      // 210,00 the base line declares.
                      lines: transaction.lines.map((line) =>
                        line.accID === '1500' ? { ...line, amount: 209_00n } : line,
                      ),
                    },
                    ...sales.transactions.slice(1),
                  ],
                },
          ),
        }
      })(),
    )

    const plan = planXafImport(withoutVatLine, options)
    expect(plan.warnings.join(' ')).toContain('H21 21000')

    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    expect(sale?.lines.find((line) => line.accountNumber === '8000')?.taxRole).toBe('base')
    expect(sale?.lines.find((line) => line.accountNumber === '1500')?.taxRole).toBeNull()
  })

  it('refuses a file whose tax codes this administration does not have', () => {
    // Not a warning. The entries would post, the trial balance would
    // reconcile, and the aangifte would quietly declare nothing for a whole
    // migrated year — discovered at the next filing, when the file is gone.
    const plan = planWith({ existingTaxCodes: [] })

    expect(plan.problems.map((problem) => problem.code)).toContain('unknown_tax_code')
    expect(plan.problems[0]?.message).toContain('H21')
    // And it says what it is for, so somebody can map it.
    expect(plan.vatCodes).toEqual([{ code: 'H21', description: 'BTW hoog 21%', exists: false }])
  })

  it('lists the cost centres and projects the file uses', () => {
    const plan = planWith({})
    expect(plan.dimensions).toEqual(
      expect.arrayContaining([
        { typeCode: 'COSTCENTRE', valueCode: 'ALG', exists: true },
        { typeCode: 'PROJECT', valueCode: 'PRJ-01', exists: true },
      ]),
    )

    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    const base = sale?.lines.find((line) => line.accountNumber === '8000')
    expect(base?.dimensions).toEqual([
      { typeCode: 'COSTCENTRE', valueCode: 'ALG' },
      { typeCode: 'PROJECT', valueCode: 'PRJ-01' },
    ])
  })

  it('imports without a dimension we do not have, and says so', () => {
    // A warning rather than a refusal: losing a cost centre costs analysis, not
    // correctness, and refusing every file whose dimensions do not exist yet
    // would make the first run impossible.
    const plan = planWith({ existingDimensionValues: [] })

    expect(plan.problems).toEqual([])
    expect(plan.warnings.join(' ')).toContain('COSTCENTRE ALG')

    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    expect(sale?.lines.find((line) => line.accountNumber === '8000')?.dimensions).toEqual([])
  })

  it('links a line to the contact it names, on the right subledger', () => {
    const plan = planWith({})

    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    const receivable = sale?.lines.find((line) => line.accountNumber === '1300')
    expect(receivable?.subledgerKind).toBe('customer')
    expect(receivable?.subledgerId).toBe('11111111-1111-4111-8111-111111111111')

    // The journal decides, not the party record: a line in an inkoopboek is a
    // creditor whatever `custSupTp` says.
    const purchase = plan.entries.find((entry) => entry.sourceDocumentRef === 'INK-2026-0001')
    const cost = purchase?.lines.find((line) => line.accountNumber === '4000')
    expect(cost?.subledgerKind).toBe('supplier')
    expect(cost?.subledgerId).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('lists contacts it could not link, and imports the entries anyway', () => {
    const plan = planWith({ contactIdsByNumber: new Map() })

    expect(plan.problems).toEqual([])
    expect(plan.warnings.join(' ')).toContain('DEB-0001')
    expect(plan.contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: 'DEB-0001', name: 'Klant B.V.', exists: false }),
      ]),
    )

    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    expect(sale?.lines.find((line) => line.accountNumber === '1300')?.subledgerId).toBeNull()
    // The entry itself is untouched: a missing contact is not a missing amount.
    expect(sale?.lines.reduce((sum, line) => sum + line.debit - line.credit, 0n)).toBe(0n)
  })

  it('survives a round trip through our own exporter', () => {
    // The claim this whole change makes good: export, import, and the tags are
    // still there. Before it, a migrated year came back untagged and an XAF
    // generated from it declared no VAT at all.
    const plan = planWith({})
    const sale = plan.entries.find((entry) => entry.sourceDocumentRef === 'VRK-2026-001')
    const base = sale?.lines.find((line) => line.accountNumber === '8000')

    expect({
      taxCode: base?.taxCode,
      taxRole: base?.taxRole,
      taxAmount: base?.taxAmount,
      dimensions: base?.dimensions,
    }).toEqual({
      taxCode: 'H21',
      taxRole: 'base',
      taxAmount: 210_00n,
      dimensions: [
        { typeCode: 'COSTCENTRE', valueCode: 'ALG' },
        { typeCode: 'PROJECT', valueCode: 'PRJ-01' },
      ],
    })
  })
})
