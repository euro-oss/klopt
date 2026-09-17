import noNumberMoney from './rules/no-number-money.js'

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: '@klopt/eslint-plugin', version: '0.0.0' },
  rules: {
    'no-number-money': noNumberMoney,
  },
}

export default plugin
