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

export { type LedgerErrorCode, type LedgerViolation, LedgerError, violation } from './errors.js'

export { isUuid, uuidv7, uuidv7Timestamp } from './ids.js'

export * from './ledger/index.js'
export * from './rgs/index.js'
export * from './xaf/index.js'
export * from './reference/index.js'
export * from './auth/index.js'
export { complianceOperations, ledgerOperations } from './operations.js'
