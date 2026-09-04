import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, it } from 'vitest'
import rule from '../rules/no-number-money.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2023, sourceType: 'module' },
})

const errors = [{ messageId: 'numberMoney' }]

ruleTester.run('no-number-money', rule, {
  valid: [
    // The representations we actually want.
    'interface Line { amount: Money }',
    'interface Line { amount: MoneyWire }',
    'interface Line { totalMinorUnits: bigint }',

    // Not money.
    'interface Line { quantity: number }',
    'interface Line { lineCount: number }',
    'interface Line { exchangeRate: number }',
    'interface Line { discountPercentage: number }',

    // Money-shaped name, but not a number.
    'interface Line { totalAmount: string }',
    'const schema = z.object({ totalAmount: z.string() })',

    // Explicitly excused.
    {
      code: 'interface Row { balance: number }',
      options: [{ ignore: ['balance'] }],
    },
  ],

  invalid: [
    // The camelCase case, which is the one that matters and the one a naive
    // regex misses.
    { code: 'interface Line { totalAmount: number }', errors },
    { code: 'interface Line { vatAmount: number }', errors },
    { code: 'interface Line { openingBalance: number }', errors },

    // Acronym runs and snake_case.
    { code: 'interface Line { VATAmount: number }', errors },
    { code: 'interface Row { vat_amount: number }', errors },
    { code: 'interface Row { "total-price": number }', errors },

    // Bare and plural.
    { code: 'interface Line { amount: number }', errors },
    { code: 'interface Line { amounts: number[] }', errors },

    // Class fields and locals, not just interfaces.
    { code: 'class Line { declare totalAmount: number }', errors },
    { code: 'const invoiceTotal: number = 0', errors },

    // Validation schemas are DTOs too.
    { code: 'const s = z.object({ totalAmount: z.number() })', errors },
    { code: 'const s = z.object({ totalAmount: z.coerce.number() })', errors },
    { code: 'const s = v.object({ vatAmount: v.number() })', errors },

    // Configurable extra vocabulary.
    {
      code: 'interface Row { koersverschil: number }',
      options: [{ words: ['koersverschil'] }],
      errors,
    },
  ],
})
