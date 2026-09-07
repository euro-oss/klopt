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
} from './unit-of-work.js'
export * as schema from './schema/index.js'
