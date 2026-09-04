/**
 * @klopt/core — the accounting domain.
 *
 * This package must not import a web framework, a database driver or an
 * adapter. See eslint.config.js for the enforced boundary and
 * docs/decisions/0005-domain-boundary-enforcement.md for why.
 */
export {
  type CurrencyCode,
  type Money,
  type MoneyWire,
  MoneyFormatError,
  fromWire,
  minorUnitExponent,
  money,
  toWire,
} from './money.js'

export {
  type AgentExposure,
  type OperationDefinition,
  type OperationKind,
  DuplicateOperationError,
  InvalidOperationError,
  clearOperationsForTest,
  defineOperation,
  getOperation,
  listOperations,
} from './operation.js'
