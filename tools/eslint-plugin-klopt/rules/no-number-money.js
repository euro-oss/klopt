/**
 * Money must never touch a JS `number`.
 *
 * Requirement 6.1 / 11.1 of the spec: amounts are integer minor units (`bigint`)
 * plus an ISO 4217 currency code, and cross the wire as a decimal string. A
 * `number` in the money path is a rounding bug that only shows up in someone
 * else's trial balance, so it is a lint error rather than a review comment.
 *
 * The rule is name-driven, which makes it a tripwire and not a proof. It catches
 * the accidental `totalAmount: number`; it cannot catch `x: number` holding a
 * total.
 */

/**
 * Words that name an amount of money. Matched per word after splitting the
 * identifier, so `totalAmount`, `vat_amount` and `VATAmount` all hit.
 *
 * Deliberately absent: `rate` (an FX rate is not money and needs its own
 * representation decision) and `count`.
 */
const DEFAULT_WORDS = [
  'amount',
  'balance',
  'btw',
  'cost',
  'credit',
  'debit',
  'fee',
  'money',
  'payable',
  'price',
  'receivable',
  'revenue',
  'subtotal',
  'total',
  'turnover',
  'vat',
]

/**
 * Words that turn a money-shaped name into something that is not money.
 * `balanceSheetAccountCount` counts accounts; `mappableBalanceBasisPoints` is a
 * ratio. Both legitimately are `number`, and flagging them would train people
 * to reach for eslint-disable, which is worse than the rule not firing.
 *
 * Matched on the **last** word only: `countedAmount` is still an amount.
 */
const NOT_MONEY_SUFFIXES = new Set([
  'count',
  'days',
  'index',
  'number',
  'percent',
  'percentage',
  'points',
  'rate',
  'ratio',
  'share',
])

const MESSAGE =
  'Money must not be typed as `number`. Use `Money` (bigint minor units + currency) in the domain, or `MoneyWire` (decimal string + currency) at the boundary.'

/**
 * Split an identifier into lowercase words. Handles camelCase, PascalCase,
 * SCREAMING_SNAKE and acronym runs (`VATAmount` -> `vat`, `amount`).
 *
 * @param {string} name
 * @returns {string[]}
 */
function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/** @param {unknown} node */
function keyName(node) {
  if (!node || typeof node !== 'object') return null
  const candidate = /** @type {{ type?: string, name?: string, value?: unknown }} */ (node)
  if (candidate.type === 'Identifier' && typeof candidate.name === 'string') return candidate.name
  if (candidate.type === 'Literal' && typeof candidate.value === 'string') return candidate.value
  return null
}

/** `number` or `number[]`, which is the same mistake wearing a hat. */
function isNumberType(typeNode) {
  if (!typeNode) return false
  if (typeNode.type === 'TSNumberKeyword') return true
  if (typeNode.type === 'TSArrayType') return isNumberType(typeNode.elementType)
  return false
}

/** Matches `z.number()`, `z.coerce.number()` and the Valibot equivalents. */
function isSchemaNumberCall(node) {
  if (!node || node.type !== 'CallExpression') return false
  const callee = node.callee
  if (!callee || callee.type !== 'MemberExpression') return false
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'number') return false

  let root = callee.object
  while (root.type === 'MemberExpression') root = root.object
  return root.type === 'Identifier' && (root.name === 'z' || root.name === 'v')
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `number` as the type of a money-shaped field.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Extra money words, added to the defaults. */
          words: { type: 'array', items: { type: 'string' } },
          /** Exact field names to skip. */
          ignore: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: { numberMoney: MESSAGE },
  },

  create(context) {
    const options = context.options[0] ?? {}
    const moneyWords = new Set([...DEFAULT_WORDS, ...(options.words ?? [])])
    const ignored = new Set(options.ignore ?? [])

    /** @param {string | null} name */
    function isMoneyName(name) {
      if (name === null || ignored.has(name)) return false

      const parts = words(name)
      const last = parts[parts.length - 1]
      if (last !== undefined && NOT_MONEY_SUFFIXES.has(last)) return false

      return parts.some((word) => moneyWords.has(word) || moneyWords.has(word.replace(/s$/, '')))
    }

    function checkTyped(node) {
      if (!isMoneyName(keyName(node.key))) return
      if (!isNumberType(node.typeAnnotation?.typeAnnotation)) return
      context.report({ node, messageId: 'numberMoney' })
    }

    return {
      TSPropertySignature: checkTyped,
      PropertyDefinition: checkTyped,

      // Zod and Valibot object schemas are DTOs too, and are where this
      // actually slips in.
      Property(node) {
        if (!isMoneyName(keyName(node.key))) return
        if (!isSchemaNumberCall(node.value)) return
        context.report({ node, messageId: 'numberMoney' })
      },

      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') return
        if (!isMoneyName(node.id.name)) return
        if (!isNumberType(node.id.typeAnnotation?.typeAnnotation)) return
        context.report({ node: node.id, messageId: 'numberMoney' })
      },
    }
  },
}
