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
export * from './ubl/index.js'
export * from './format/index.js'
export * from './invoice/index.js'
export * from './xml/index.js'
export * from './bank/index.js'
export * from './payments/index.js'
export * from './reference/index.js'
export * from './auth/index.js'
export * from './ports/index.js'
export * from './purchase/index.js'
export * from './inbound/index.js'
export * from './retention/index.js'
export * from './snapshot/index.js'
export * from './exact/index.js'
export * from './sales/index.js'
export * from './setup/index.js'
export * from './vat/index.js'
export {
  bankingOperations,
  complianceOperations,
  exactOperations,
  inboxOperations,
  ledgerOperations,
  membershipOperations,
  paymentOperations,
  provisioningOperations,
  purchaseOperations,
  salesOperations,
  vatOperations,
} from './operations.js'
