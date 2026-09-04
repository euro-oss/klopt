import { defineOperation, type OperationDefinition } from './operation.js'

/**
 * The ledger's public operations.
 *
 * Registering here is what obliges apps/web to expose a REST route: the
 * contract test fails the build for any operation without one. Adding a
 * capability to the UI without adding it to the API is therefore not something
 * you can forget to do, it is something you cannot do.
 */
export const ledgerOperations: Readonly<Record<string, OperationDefinition>> = {
  postJournalEntry: defineOperation({
    id: 'ledger.postJournalEntry',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Post a balanced journal entry. Supports dry run.',
    // An agent drafts; a human releases. Posting to the ledger is exactly the
    // category spec 10.3 puts behind the proposal model.
    agentExposure: 'proposal',
    idempotent: true,
  }),

  reverseJournalEntry: defineOperation({
    id: 'ledger.reverseJournalEntry',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Post the reversal of an existing entry. Corrections are reversals.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  getJournalEntry: defineOperation({
    id: 'ledger.getJournalEntry',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'One journal entry with its lines, dimensions and chain position.',
    agentExposure: 'read',
    idempotent: true,
  }),

  listJournalEntries: defineOperation({
    id: 'ledger.listJournalEntries',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Journal entries, cursor-paginated, filterable by period and journal.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getTrialBalance: defineOperation({
    id: 'ledger.getTrialBalance',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Trial balance for a fiscal year and period range.',
    agentExposure: 'read',
    idempotent: true,
  }),

  verifyChain: defineOperation({
    id: 'ledger.verifyChain',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Recompute the entity hash chain and return the head hash and any breaks.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getBalanceSheet: defineOperation({
    id: 'ledger.getBalanceSheet',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Balance sheet as at a date, with the unappropriated result shown in equity.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getProfitAndLoss: defineOperation({
    id: 'ledger.getProfitAndLoss',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Profit and loss for a period range.',
    agentExposure: 'read',
    idempotent: true,
  }),

  closeYear: defineOperation({
    id: 'ledger.closeYear',
    kind: 'write',
    permission: 'ledger:close',
    summary: 'Appropriate the result and carry the balance sheet forward. Supports dry run.',
    // Closing a year is not something an agent does unsupervised.
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listAccounts: defineOperation({
    id: 'ledger.listAccounts',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Chart of accounts with RGS codes and dimension requirements.',
    agentExposure: 'read',
    idempotent: true,
  }),
}

/**
 * RGS mapping and the compliance exports.
 *
 * `exportAuditFile` is a read: it derives a file from the journal and changes
 * nothing. `importAuditFile` is a write, and a proposal for an agent, because
 * it can create thousands of entries.
 */
export const complianceOperations: Readonly<Record<string, OperationDefinition>> = {
  getRgsCoverage: defineOperation({
    id: 'rgs.getCoverage',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'RGS mapping coverage: how much is mapped, and what is wrong with it.',
    agentExposure: 'read',
    idempotent: true,
  }),

  setRgsMappings: defineOperation({
    id: 'rgs.setMappings',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Map ledger accounts onto RGS codes. Validated against the loaded scheme.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  previewRgsUpgrade: defineOperation({
    id: 'rgs.previewUpgrade',
    kind: 'read',
    permission: 'ledger:read',
    summary: "What moving to another RGS version would do to this entity's mappings.",
    agentExposure: 'read',
    idempotent: true,
  }),

  exportAuditFile: defineOperation({
    id: 'export.auditFile',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'XAF 3.2 auditfile with RGS lead codes, schema-validated before it is returned.',
    agentExposure: 'read',
    idempotent: true,
  }),

  importAuditFile: defineOperation({
    id: 'import.auditFile',
    kind: 'write',
    permission: 'ledger:import',
    summary: 'Import an XAF 3.2 auditfile. Dry run produces a reconciliation report.',
    agentExposure: 'proposal',
    idempotent: true,
  }),
}
