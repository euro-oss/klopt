import { describe, expect, it } from 'vitest'
import {
  PURCHASE_INVOICE_STATUSES,
  RETENTION_CLASSES,
  STATEMENT_SECTIONS,
  VAT_PERIOD_KINDS,
  DEFAULT_DUNNING_SCHEDULE,
  VIOLATION_MESSAGES,
  type ViolationMessageKey,
} from '@klopt/core'
import { en } from '../src/i18n/en.js'
import { nl } from '../src/i18n/nl.js'
import { translate } from '../src/i18n/locale.js'
import {
  DUNNING_TONES,
  dunningStageLabel,
  purchaseStatusLabel,
  retentionClassLabel,
  statementSectionLabel,
  vatPeriodLabel,
  violationMessage,
} from '../src/i18n/labels.js'
import type { MessageKey } from '../src/i18n/nl.js'

/**
 * Every code the server sends has a label, in both languages (ADR 0045).
 *
 * The enumerations are imported from `@klopt/core` rather than listed here, so
 * adding a purchase status or a retention class fails this test until it has
 * been translated. Listing them twice would make the test agree with itself:
 * somebody adds `on_hold`, adds it to a local copy of the list, and the
 * missing translation is never noticed until a screen shows a key.
 */

const LOCALES = [
  ['nl', nl],
  ['en', en],
] as const

/** `t` for one locale, which is what the label helpers take. */
const translator =
  (locale: 'nl' | 'en') => (key: MessageKey, values?: Record<string, string | number>) =>
    translate(locale, key, values)

/**
 * A translation that came out as its own message key never got written.
 *
 * Compared against the *message key*, not the code: `label.purchaseStatus.draft`
 * is legitimately "draft" in English, and comparing against the code would call
 * that a failure.
 */
function expectTranslated(locale: string, key: MessageKey, produced: string): void {
  expect(produced, `${locale}: ${key}`).not.toBe(key)
  expect(produced, `${locale}: ${key}`).not.toBe('')
  // `{name}` left in the output is the placeholder mechanism telling us a
  // value was not supplied. Visible on purpose, and a bug here.
  expect(produced, `${locale}: ${key}`).not.toMatch(/\{[a-zA-Z]+\}/)
}

describe('every server-sent code has a label', () => {
  for (const [locale, catalogue] of LOCALES) {
    const t = translator(locale)

    it(`translates every purchase invoice status in ${locale}`, () => {
      expect(PURCHASE_INVOICE_STATUSES.length).toBeGreaterThan(0)
      for (const status of PURCHASE_INVOICE_STATUSES) {
        expect(catalogue).toHaveProperty(`label.purchaseStatus.${status}`)
        expectTranslated(locale, `label.purchaseStatus.${status}`, purchaseStatusLabel(t, status))
      }
    })

    it(`translates every statement section in ${locale}`, () => {
      for (const section of STATEMENT_SECTIONS) {
        expect(catalogue).toHaveProperty(`label.statementSection.${section}`)
        expectTranslated(
          locale,
          `label.statementSection.${section}`,
          statementSectionLabel(t, section),
        )
      }
    })

    it(`translates every retention class in ${locale}`, () => {
      for (const retentionClass of RETENTION_CLASSES) {
        expect(catalogue).toHaveProperty(`label.retentionClass.${retentionClass}`)
        expectTranslated(
          locale,
          `label.retentionClass.${retentionClass}`,
          retentionClassLabel(t, retentionClass),
        )
      }
    })

    it(`translates every dunning tone in ${locale}`, () => {
      for (const tone of DUNNING_TONES) {
        expect(catalogue).toHaveProperty(`label.dunningTone.${tone}`)
        expectTranslated(locale, `label.dunningTone.${tone}`, dunningStageLabel(t, tone))
      }
    })

    it(`translates every VAT period kind in ${locale}`, () => {
      for (const kind of VAT_PERIOD_KINDS) {
        expect(catalogue).toHaveProperty(`label.vatPeriod.${kind}`)
      }
    })
  }

  it('covers every tone the shipped dunning schedule uses', () => {
    // The other direction: a fourth stage with a new tone would otherwise get
    // a label nobody wrote, and the test above would still pass because it
    // only walks the tones this file knows about.
    for (const stage of DEFAULT_DUNNING_SCHEDULE) {
      expect(DUNNING_TONES, `stage ${String(stage.stage)}`).toContain(stage.tone)
    }
  })
})

describe('the VAT period label, which is built rather than looked up', () => {
  const nlT = translator('nl')
  const enT = translator('en')

  it('names the month in the reader’s language, from Intl rather than a catalogue', () => {
    expect(vatPeriodLabel(nlT, 'nl-NL', 'monthly', '2026-03')).toBe('maart 2026')
    expect(vatPeriodLabel(enT, 'en-GB', 'monthly', '2026-03')).toBe('March 2026')
  })

  it('says a quarter the way each language says it', () => {
    // Dutch bookkeepers say "1e kwartaal"; English speakers say "Q1". The
    // difference is the reason this is a translated template and not a
    // formatted number.
    expect(vatPeriodLabel(nlT, 'nl-NL', 'quarterly', '2026-Q1')).toBe('1e kwartaal 2026')
    expect(vatPeriodLabel(enT, 'en-GB', 'quarterly', '2026-Q1')).toBe('Q1 2026')
  })

  it('handles a year', () => {
    expect(vatPeriodLabel(nlT, 'nl-NL', 'annual', '2026')).toBe('Jaar 2026')
    expect(vatPeriodLabel(enT, 'en-GB', 'annual', '2026')).toBe('Year 2026')
  })

  it('does not lose the year when the code is malformed', () => {
    // A period code comes out of a URL. Showing "2026" beats showing nothing,
    // and beats throwing on a page somebody linked to.
    expect(vatPeriodLabel(enT, 'en-GB', 'monthly', '2026-xx')).toContain('2026')
  })
})

describe('what stays Dutch, deliberately', () => {
  it('has no translation for a rubriek name', () => {
    /**
     * "Leveringen/diensten belast met hoog tarief" is the text printed next to
     * box 1a on the Belastingdienst's form. A bookkeeper filing a Dutch return
     * reads our screen and the form side by side; translating it would mean
     * the two no longer match, and the words on the form are the ones that
     * matter. See ADR 0045.
     */
    const keys = Object.keys(nl).filter((key) => key.startsWith('label.rubriek'))
    expect(keys).toEqual([])
  })
})

/**
 * Every sentence the domain can say, in both languages (ADR 0046).
 *
 * `VIOLATION_MESSAGES` is the list, imported rather than restated, so adding a
 * message to `@klopt/core` fails this until it has been translated. That is
 * the whole mechanism: the default locale is Dutch, and a Dutch bookkeeper
 * seeing "No account 1300." is the defect this closes.
 */
describe('the domain’s refusals', () => {
  const keys = Object.keys(VIOLATION_MESSAGES) as ViolationMessageKey[]

  it('has more than a hundred of them, so this is walking the real list', () => {
    expect(keys.length).toBeGreaterThan(100)
  })

  it('translates every one into Dutch', () => {
    const missing = keys.filter((key) => !(`violation.${key}` in nl))
    expect(missing).toEqual([])
  })

  it('takes the English from the domain rather than restating it', () => {
    // Not a copy: `en.ts` spreads `VIOLATION_MESSAGES`. If somebody ever types
    // one of these out by hand, this catches the first one that drifts.
    for (const key of keys) {
      expect(en[`violation.${key}`], key).toBe(VIOLATION_MESSAGES[key].text)
    }
  })

  it('uses the same placeholders in both languages', () => {
    // A Dutch sentence that forgot `{accountNumber}` loses the account number;
    // one that invented `{account}` shows the braces to the user.
    const placeholders = (text: string) =>
      [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()

    for (const key of keys) {
      expect(placeholders(nl[`violation.${key}`]), key).toEqual(
        placeholders(VIOLATION_MESSAGES[key].text),
      )
    }
  })

  // That every message names a real `LedgerErrorCode` needs no test: the
  // catalogue is `satisfies Readonly<Record<string, ViolationMessage>>`, so a
  // made-up code does not compile.
})

describe('turning a violation into a sentence', () => {
  const nlT = translator('nl')
  const enT = translator('en')

  const unbalanced = {
    code: 'entry_unbalanced',
    path: 'lines',
    messageKey: 'entry_unbalanced.does_not_balance',
    message: 'Entry does not balance in EUR: debits minus credits is 500 minor units.',
    detail: { currency: 'EUR', difference: '500' },
  }

  it('says it in Dutch for a Dutch reader, with the numbers in it', () => {
    const dutch = violationMessage(nlT, unbalanced)
    expect(dutch).toContain('EUR')
    expect(dutch).toContain('500')
    expect(dutch).not.toBe(unbalanced.message)
    expect(dutch).not.toContain('{')
  })

  it('gives an English reader back what the server sent', () => {
    expect(violationMessage(enT, unbalanced)).toBe(unbalanced.message)
  })

  it('falls back to the server’s sentence when there is no key', () => {
    // A violation forwarded from a finding carries somebody else's message and
    // no key of its own. English is better than a blank or a key.
    const forwarded = {
      code: 'invalid_payment',
      message: 'IBAN NL00 is not valid.',
      messageKey: null,
    }
    expect(violationMessage(nlT, forwarded)).toBe('IBAN NL00 is not valid.')
  })

  it('falls back when the key is one nobody has translated', () => {
    const unknown = {
      code: 'x',
      message: 'Something specific went wrong.',
      messageKey: 'not_a_real_key',
    }
    expect(violationMessage(nlT, unknown)).toBe('Something specific went wrong.')
  })

  it('leaves a placeholder visible when its value is missing', () => {
    // Deliberate: an obvious `{accountNumber}` is a bug somebody reports, and
    // a blank is one nobody notices.
    const noDetail = {
      code: 'unknown_account',
      message: 'No account 1300.',
      messageKey: 'unknown_account.account',
    }
    expect(violationMessage(nlT, noDetail)).toContain('{accountNumber}')
  })
})
