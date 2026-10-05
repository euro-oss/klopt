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

export {
  type LedgerErrorCode,
  type LedgerViolation,
  LedgerError,
  forwarded,
  violation,
} from './errors.js'
export {
  FINDING_MESSAGES,
  renderFindingMessage,
  type FindingMessageKey,
} from './finding-messages.js'
export {
  VIOLATION_MESSAGES,
  renderViolationMessage,
  type ViolationMessage,
  type ViolationMessageKey,
} from './violation-messages.js'

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
export * from './documents/index.js'
export * from './purchase/index.js'
export * from './inbound/index.js'
export * from './net/index.js'
export * from './events/index.js'
export * from './modules/index.js'
export * from './retention/index.js'
export * from './snapshot/index.js'
export * from './discovery.js'
export { KLOPT_VERSION } from './version.js'
export * from './exact/index.js'
export {
  MONEYBIRD_NOT_IMPORTED,
  MoneybirdReadError,
  contactName,
  describeAdministration,
  findAdministration,
  minorFromMoneybirdAmount,
  parseAdministration,
  parseContact,
  parseFinancialAccount,
  parseFinancialMutation,
  parseGeneralDocument,
  parseJournalDocument,
  parseLedgerAccount,
  parsePurchaseInvoice,
  parseReceipt,
  parseSalesInvoice,
  parseTaxRate,
  planMoneybirdImport,
  readArray,
  readId,
  requireId,
  selectableAdministrations,
  yearOf,
  classifyAccount as classifyMoneybirdAccount,
  parseAttachment as parseMoneybirdAttachment,
  readBoolean as readMoneybirdBoolean,
  readDate as readMoneybirdDate,
  readMinor as readMoneybirdMinor,
  readNumber as readMoneybirdNumber,
  readString as readMoneybirdString,
  requireDate as requireMoneybirdDate,
  requireMinor as requireMoneybirdMinor,
  requireString as requireMoneybirdString,
  type ClassifiedAccount as MoneybirdClassifiedAccount,
  type ExistingTaxRule,
  type MoneybirdImportOptions,
  type MoneybirdImportPlan,
  type MoneybirdJournalDocument,
  type MoneybirdJournalLine,
  type MoneybirdLedgerAccount,
  type MoneybirdMutationPayment,
  type MoneybirdPlannedAccount,
  type MoneybirdPlannedContact,
  type MoneybirdPlannedDocument,
  type MoneybirdPlannedEntry,
  type MoneybirdPlannedFinancialAccount,
  type MoneybirdPlannedTaxRate,
  type MoneybirdProblem,
  type MoneybirdProblemCode,
  type MoneybirdPurchaseDocument,
  type MoneybirdSalesInvoice,
  type MoneybirdSnapshot,
  type MoneybirdTaxRate,
  type SelectableAdministration,
  type UnreadableResource as MoneybirdUnreadableResource,
  type YearTrialBalance,
  type MoneybirdAttachment,
  type MoneybirdContact,
  type MoneybirdDocumentDetail,
  type MoneybirdFinancialAccount,
  type MoneybirdFinancialMutation,
  type MoneybirdGeneralDocument,
} from './moneybird/index.js'
export * from './oauth/index.js'
export * from './sales/index.js'
export * from './setup/index.js'
export * from './vat/index.js'
export {
  bankingOperations,
  complianceOperations,
  discoveryOperations,
  exactOperations,
  moneybirdOperations,
  inboxOperations,
  ledgerOperations,
  membershipOperations,
  paymentOperations,
  provisioningOperations,
  purchaseOperations,
  salesOperations,
  vatOperations,
} from './operations.js'
