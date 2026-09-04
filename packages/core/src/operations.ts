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

  listAccounts: defineOperation({
    id: 'ledger.listAccounts',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Chart of accounts with RGS codes and dimension requirements.',
    agentExposure: 'read',
    idempotent: true,
  }),
}
