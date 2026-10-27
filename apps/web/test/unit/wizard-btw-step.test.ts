import { describe, expect, it } from 'vitest'
import { canAdvanceFromBtw } from '../../src/lib/import-wizard.js'
import { translate } from '../../src/i18n/locale.js'
import { refusedRateMessage } from '../../src/lib/refused-rate-message.js'
import { rebuildExcludedRates } from '../../src/lib/import-wizard-run.js'

describe('wizard step 5 btw gates (#105 PM)', () => {
  it('keeps Volgende off when rates only have proposals (not confirmed)', () => {
    expect(
      canAdvanceFromBtw({
        usedRates: [
          { moneybirdId: 'a', mapped: false },
          { moneybirdId: 'b', mapped: false },
        ],
        excludedRateIds: new Set(),
      }),
    ).toBe(false)
  })

  it('enables Volgende after Bevestigen (mapped) on every used rate', () => {
    expect(
      canAdvanceFromBtw({
        usedRates: [
          { moneybirdId: 'a', mapped: true },
          { moneybirdId: 'b', mapped: true },
        ],
        excludedRateIds: new Set(),
      }),
    ).toBe(true)
  })

  it('allows #92/#93 dead end via Niet overzetten, and undo blocks again', () => {
    const used = [{ moneybirdId: 'dead', mapped: false }]
    expect(canAdvanceFromBtw({ usedRates: used, excludedRateIds: new Set(['dead']) })).toBe(true)
    expect(canAdvanceFromBtw({ usedRates: used, excludedRateIds: new Set() })).toBe(false)
  })

  it('rebuilds excluded rates from persisted excludedExternalIds after remount', () => {
    const rebuilt = rebuildExcludedRates({
      excludedExternalIds: ['sales_invoice:1', 'sales_invoice:2'],
      rates: [{ moneybirdId: 'dead' }],
      docsForRate: () => ['sales_invoice:1', 'sales_invoice:2'],
    })
    expect(rebuilt.rateIds.has('dead')).toBe(true)
    expect(
      canAdvanceFromBtw({
        usedRates: [{ moneybirdId: 'dead', mapped: false }],
        excludedRateIds: rebuilt.rateIds,
      }),
    ).toBe(true)
  })
})

describe('wizard.btw.refusedRate placeholders (#105 Legal/PM)', () => {
  it('fills code, ratePct and codePct in NL and EN', () => {
    const rules = [{ code: 'H21', rateBasisPoints: 2100 }]
    const nl = refusedRateMessage(
      { percentage: '21' },
      { rejected: 'H21', message: 'raw' },
      (key, values) => translate('nl', key, values),
      rules,
    )
    expect(nl).toContain('H21')
    expect(nl).toContain('21%')
    expect(nl).not.toContain('{code}')
    expect(nl).not.toContain('{ratePct}')
    expect(nl).not.toContain('{codePct}')
    expect(nl).toMatch(/Klopt weigert H21/)

    const en = refusedRateMessage(
      { percentage: '9' },
      { rejected: 'L9', message: 'raw' },
      (key, values) => translate('en', key, values),
      [{ code: 'L9', rateBasisPoints: 900 }],
    )
    expect(en).toContain('L9')
    expect(en).toContain('9%')
    expect(en).not.toContain('{code}')
    expect(en).toMatch(/Klopt refuses L9/)
  })
})
