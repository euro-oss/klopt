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

  listFiscalYears: defineOperation({
    id: 'ledger.listFiscalYears',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Fiscal years with their periods and status.',
    agentExposure: 'read',
    idempotent: true,
  }),

  createFiscalYear: defineOperation({
    id: 'ledger.createFiscalYear',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Open the next book year and its twelve periods.',
    agentExposure: 'proposal',
    // Naturally so: a year code is unique per entity, and asking twice for
    // 2027 returns the 2027 that already exists.
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

/**
 * Sales (M1).
 *
 * Issuing is a `proposal` for an agent: it allocates a legally gapless invoice
 * number and posts to the ledger, which is not something an agent does
 * unsupervised (spec 10.3). Drafting is too — a draft invoice with the wrong
 * customer on it still ends up in front of a human.
 */
export const salesOperations: Readonly<Record<string, OperationDefinition>> = {
  listContacts: defineOperation({
    id: 'sales.listContacts',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Contacts, filterable to customers.',
    agentExposure: 'read',
    idempotent: true,
  }),

  createContact: defineOperation({
    id: 'sales.createContact',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Create a contact.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listTaxCodes: defineOperation({
    id: 'sales.listTaxCodes',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Tax codes with their rates and ledger accounts.',
    agentExposure: 'read',
    idempotent: true,
  }),

  draftInvoice: defineOperation({
    id: 'sales.draftInvoice',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Create a draft sales invoice or credit note, priced but unposted.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  issueInvoice: defineOperation({
    id: 'sales.issueInvoice',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Number a draft, post it to the ledger, and make it final.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  getInvoice: defineOperation({
    id: 'sales.getInvoice',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'One invoice with its lines and tax summary.',
    agentExposure: 'read',
    idempotent: true,
  }),

  listInvoices: defineOperation({
    id: 'sales.listInvoices',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Sales invoices, filterable by status.',
    agentExposure: 'read',
    idempotent: true,
  }),

  listOverdueInvoices: defineOperation({
    id: 'sales.listOverdueInvoices',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Issued invoices past their due date, for dunning.',
    agentExposure: 'read',
    idempotent: true,
  }),
}

/**
 * Provisioning (principle 4: "self-hosted is complete, not crippled").
 *
 * These are the only operations that are not scoped to an entity — they are how
 * an entity comes to exist. That makes their permission unusual: `entity:create`
 * is held by a signed-in human and by no API token, because a token is issued
 * *by* an administration and must not be able to create another one.
 *
 * `agentExposure: 'none'` for the same reason it is `proposal` elsewhere and
 * more so. Creating a legal entity's books is not a thing an agent does.
 */
export const provisioningOperations: Readonly<Record<string, OperationDefinition>> = {
  listCharts: defineOperation({
    id: 'setup.listCharts',
    kind: 'read',
    permission: 'entity:create',
    summary: 'The charts of accounts a new administration can be provisioned from.',
    agentExposure: 'none',
    idempotent: true,
  }),

  createEntity: defineOperation({
    id: 'setup.createEntity',
    kind: 'write',
    permission: 'entity:create',
    summary: 'Create an administration from a chart, with its first book year, and own it.',
    agentExposure: 'none',
    // The client chooses the id, so a retry lands on the same administration
    // rather than a second one. See the handler.
    idempotent: true,
  }),
}

/**
 * Membership (spec 4).
 *
 * All four take `members:manage`, which only an owner has: membership is the
 * one thing that can lock everybody else out, including the person doing it.
 * `agentExposure: 'none'` throughout — granting access to somebody's books is
 * not a thing an agent proposes, let alone does.
 */
export const membershipOperations: Readonly<Record<string, OperationDefinition>> = {
  listMembers: defineOperation({
    id: 'members.list',
    kind: 'read',
    permission: 'members:manage',
    summary: 'Who can see these books, as what, and who has been invited but not signed in.',
    agentExposure: 'none',
    idempotent: true,
  }),

  inviteMember: defineOperation({
    id: 'members.invite',
    kind: 'write',
    permission: 'members:manage',
    summary: 'Invite an email address to these books in a role, and send them a message.',
    agentExposure: 'none',
    // Naturally so: one live invitation per address per entity, enforced by a
    // partial unique index. Inviting twice re-sends rather than duplicating.
    idempotent: true,
  }),

  setMemberRole: defineOperation({
    id: 'members.setRole',
    kind: 'write',
    permission: 'members:manage',
    summary: "Change a member's role. Refused if it would leave no owner.",
    agentExposure: 'none',
    idempotent: true,
  }),

  removeMember: defineOperation({
    id: 'members.remove',
    kind: 'write',
    permission: 'members:manage',
    summary: 'Revoke access, or withdraw an invitation that has not been used.',
    agentExposure: 'none',
    idempotent: true,
  }),
}
