export {
  type Database,
  type DatabaseConfig,
  type Transaction,
  closeDatabase,
  createDatabase,
} from './client.js'
export {
  type Auth,
  type AuthConfig,
  type EntityMembership,
  activeEntityFor,
  addMember,
  createAuth,
  membershipFor,
  membershipsFor,
  setActiveEntity,
} from './auth.js'
export { type MigrationResult, runMigrations } from './migrate.js'
export { DrizzleLedgerRepository } from './repositories/ledger.js'
export { ReportingRepository, type TrialBalanceQuery } from './repositories/reporting.js'
export {
  type IssueTokenRequest,
  type IssuedToken,
  type ResolvedToken,
  hashToken,
  issueToken,
  listTokens,
  resolveToken,
  revokeToken,
  touchToken,
} from './repositories/tokens.js'
export { XafExportRepository, type XafExportRequest } from './repositories/xaf.js'
export { RgsRepository } from './repositories/rgs.js'
export { type InboxItemRow, InboxRepository } from './repositories/inbox.js'
export { type AuditQuery, type AuditRow, AuditRepository } from './repositories/audit.js'
export {
  type DatedDocument,
  type RetentionDocumentRow,
  RetentionRepository,
} from './repositories/retention.js'
export { type SnapshotRow, SnapshotRepository } from './repositories/snapshots.js'
export { applyRetention, type RetentionApplication } from './retention/apply.js'
export {
  SealRefusedError,
  sealFiscalYear,
  type SealOptions,
  type SealResult,
} from './snapshot/seal.js'
export { SecretKeyMissingError, decryptSecret, encryptSecret, secretsAvailable } from './secrets.js'
export { type InboundSourceRow, InboundSourceRepository } from './repositories/inbound-sources.js'
export {
  type IngestedMessage,
  type ReceiveDocumentRequest,
  type ReceivedDocument,
  type StoredParse,
  ingestInboundMessage,
  receiveDocument,
} from './inbound/receive.js'
export { type InboundPollResult, runInboundPoll } from './inbound/poll.js'
export {
  type PurchaseContext,
  type PurchaseInvoiceRow,
  PurchaseRepository,
} from './repositories/purchase.js'
export {
  type FilingSummary,
  type RecordFilingRequest,
  type StoredFiling,
  type RecordSubmissionRequest,
  type SubmissionRow,
  type VatNumberCheckRow,
  type VatPeriodQuery,
  VatRepository,
} from './repositories/vat.js'
export { type BatchSummary, PaymentsRepository } from './repositories/payments.js'
export { type BankAccountRow, type ImportOutcome, BankRepository } from './repositories/bank.js'
export {
  type InvitationRow,
  type InviteRequest,
  type InviteResult,
  type MemberRow,
  MembersRepository,
  claimInvitations,
} from './repositories/members.js'
export {
  type EntityPatch,
  type FiscalYearSummary,
  type PeriodSummary,
  type ProvisionEntityRequest,
  type ProvisionedEntity,
  SetupRepository,
} from './repositories/setup.js'
export {
  type DraftInvoiceRequest,
  type InvoiceContext,
  SalesRepository,
  invoiceEntryFor,
  priceDraft,
} from './repositories/sales.js'
export {
  withLedger,
  withReporting,
  withRgs,
  withSales,
  withSalesRead,
  withBank,
  withBankMatch,
  withBankRead,
  withMembers,
  withPayments,
  withSetup,
  withXafExport,
  withYearClose,
  withAudit,
  withAuditRead,
  withRetention,
  withRetentionRead,
  withSnapshots,
  withSnapshotsRead,
  withInboundSources,
  withInboundSourcesRead,
  withInbox,
  withInboxRead,
  withPurchase,
  withPurchasePayments,
  withPurchaseRead,
  withVat,
  withVatRead,
  withVatFiling,
} from './unit-of-work.js'
export * as schema from './schema/index.js'
