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

  getEntity: defineOperation({
    id: 'ledger.getEntity',
    kind: 'read',
    permission: 'ledger:read',
    summary: "The administration's own details: address, KvK, BTW, IBAN, book year.",
    agentExposure: 'read',
    idempotent: true,
  }),

  updateEntity: defineOperation({
    id: 'ledger.updateEntity',
    kind: 'write',
    permission: 'ledger:configure',
    summary: "Change the administration's own details. Not its chart or its book years.",
    agentExposure: 'proposal',
    // Idempotent by nature: it is a whole-field update, so applying it twice
    // leaves the same state.
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

  getInvoiceUbl: defineOperation({
    id: 'sales.getInvoiceUbl',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'The invoice as UBL 2.1 in the Peppol BIS Billing 3.0 shape, rule-checked first.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getInvoicePdf: defineOperation({
    id: 'sales.getInvoicePdf',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'The invoice as a PDF, optionally with the validated UBL attached.',
    agentExposure: 'read',
    idempotent: true,
  }),

  sendInvoice: defineOperation({
    id: 'sales.sendInvoice',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Send an issued invoice to the customer, with its UBL and its PDF.',
    // Spec 10.3 puts "send an invoice" behind the proposal model explicitly.
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listDeliveries: defineOperation({
    id: 'sales.listDeliveries',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'What was sent for this invoice, to whom, when, and whether it arrived.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getDunningQueue: defineOperation({
    id: 'sales.getDunningQueue',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Overdue invoices with the reminder each one is due, and its ageing.',
    agentExposure: 'read',
    idempotent: true,
  }),

  sendDunningReminder: defineOperation({
    id: 'sales.sendDunningReminder',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Send the next reminder for an overdue invoice. One per stage, ever.',
    agentExposure: 'proposal',
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

/**
 * Banking (M2, spec 7.4).
 *
 * Importing a statement is a write and `proposal` for an agent: it can create
 * hundreds of transactions, and an agent that imports the wrong file into the
 * wrong account has produced a wrong balance in a place people trust.
 */
export const bankingOperations: Readonly<Record<string, OperationDefinition>> = {
  listBankAccounts: defineOperation({
    id: 'bank.listAccounts',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Bank accounts, with their consent state and reconciliation position.',
    agentExposure: 'read',
    idempotent: true,
  }),

  createBankAccount: defineOperation({
    id: 'bank.createAccount',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Record a bank account and the ledger account it posts to.',
    agentExposure: 'none',
    idempotent: true,
  }),

  importStatement: defineOperation({
    id: 'bank.importStatement',
    kind: 'write',
    permission: 'ledger:import',
    summary: 'Import a CAMT.053 or MT940 file. Supports dry run. Deduplicates per entry.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  suggestMatches: defineOperation({
    id: 'bank.suggestMatches',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'What a bank line might be, with a confidence and a reason in words.',
    agentExposure: 'read',
    idempotent: true,
  }),

  confirmMatch: defineOperation({
    id: 'bank.confirmMatch',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Book a bank line: post the entry, allocate to invoices, learn the rule.',
    // It posts to the ledger, so the same rule as every other posting applies.
    agentExposure: 'proposal',
    idempotent: true,
  }),

  ignoreTransaction: defineOperation({
    id: 'bank.ignoreTransaction',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Mark a bank line as deliberately not booked. Reversible.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listMatchRules: defineOperation({
    id: 'bank.listMatchRules',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'The learned and manual matching rules, with how often each has fired.',
    agentExposure: 'read',
    idempotent: true,
  }),

  setMatchRuleActive: defineOperation({
    id: 'bank.setMatchRuleActive',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Switch a matching rule off, or back on. Learned rules are editable.',
    agentExposure: 'none',
    idempotent: true,
  }),

  listTransactions: defineOperation({
    id: 'bank.listTransactions',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Bank transactions, filterable by account and match status.',
    agentExposure: 'read',
    idempotent: true,
  }),
}

/**
 * Outbound payments (M2, spec 7.4).
 *
 * `agentExposure: 'none'` throughout, and not as a default. A payment batch is
 * the one artefact this system produces that moves real money out of the
 * building, and spec 10.3's proposal model is not enough for it: a proposal a
 * human approves is exactly what the two-person flow already is, and an agent
 * standing in for one of the two people defeats it.
 */
export const paymentOperations: Readonly<Record<string, OperationDefinition>> = {
  listBatches: defineOperation({
    id: 'payments.listBatches',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Payment batches, with their state and who submitted and approved each.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getBatch: defineOperation({
    id: 'payments.getBatch',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'One batch with its instructions and everything wrong with them.',
    agentExposure: 'read',
    idempotent: true,
  }),

  createBatch: defineOperation({
    id: 'payments.createBatch',
    kind: 'write',
    permission: 'payments:prepare',
    summary: 'Start a payment batch against a bank account and an execution date.',
    agentExposure: 'none',
    idempotent: true,
  }),

  addInstruction: defineOperation({
    id: 'payments.addInstruction',
    kind: 'write',
    permission: 'payments:prepare',
    summary: 'Add a payment to a draft batch. Refused once it has been submitted.',
    agentExposure: 'none',
    idempotent: true,
  }),

  removeInstruction: defineOperation({
    id: 'payments.removeInstruction',
    kind: 'write',
    permission: 'payments:prepare',
    summary: 'Take a payment out of a draft batch.',
    agentExposure: 'none',
    idempotent: true,
  }),

  transitionBatch: defineOperation({
    id: 'payments.transitionBatch',
    kind: 'write',
    // The narrower `payments:approve` is checked inside, per action: submitting
    // and approving are different permissions and must be, or the two-person
    // flow is one person with two clicks.
    permission: 'payments:prepare',
    summary: 'Submit, approve, reject, reopen or export a batch. Two people, or nobody.',
    agentExposure: 'none',
    idempotent: true,
  }),

  getBatchPain001: defineOperation({
    id: 'payments.getBatchPain001',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'The approved batch as SEPA pain.001. A read: exporting is a separate transition.',
    agentExposure: 'read',
    idempotent: true,
  }),
}

/**
 * The BTW-aangifte (spec 7.2).
 *
 * `getReturn` is a read even though it computes the whole thing: the return is
 * a pure function of the journal, so asking for it changes nothing and can be
 * asked as often as anybody likes. Only `file` writes, and what it writes is
 * the evidence that it was filed.
 */
export const vatOperations: Readonly<Record<string, OperationDefinition>> = {
  listPeriods: defineOperation({
    id: 'vat.listPeriods',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Declaration periods for a year, with their deadline and filing state.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getReturn: defineOperation({
    id: 'vat.getReturn',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'The BTW-aangifte for a period, derived from the journal, with the reconciliation and every line behind every rubriek.',
    agentExposure: 'read',
    idempotent: true,
  }),

  listFilings: defineOperation({
    id: 'vat.listFilings',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Everything filed, including suppleties, and whether each still matches the journal.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getIcp: defineOperation({
    id: 'vat.getIcp',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'The ICP opgaaf for a period, per counterparty, cross-checked against rubriek 3b with the VIES proof for each number.',
    agentExposure: 'read',
    idempotent: true,
  }),

  checkVatNumber: defineOperation({
    id: 'vat.checkVatNumber',
    kind: 'write',
    permission: 'ledger:configure',
    summary:
      'Ask VIES about a counterparty VAT number and store what it said, which is the evidence for the zero rate.',
    // A read of somebody else's register, but a write here: the answer and when
    // it was given become part of the entity's evidence. Idempotent by the
    // key, which replays the stored answers rather than asking VIES twice.
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listSubmissions: defineOperation({
    id: 'vat.listSubmissions',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'A filing’s whole delivery history: what was sent, when, and every status response. The evidence chain.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getFiledInstance: defineOperation({
    id: 'vat.getFiledInstance',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'The XBRL instance as filed, served from what was stored rather than regenerated.',
    agentExposure: 'read',
    idempotent: true,
  }),

  pollStatus: defineOperation({
    id: 'vat.pollStatus',
    kind: 'write',
    permission: 'vat:file',
    summary:
      'Ask the transport where a filing has got to. Delivered is not accepted, and each answer is another row in the evidence chain.',
    agentExposure: 'none',
    idempotent: true,
  }),

  fileReturn: defineOperation({
    id: 'vat.fileReturn',
    kind: 'write',
    permission: 'vat:file',
    summary:
      'File a return, storing what was declared and locking the period. A filed period files again as a suppletie.',
    // Never an agent's call: this is a statement to the tax authority.
    agentExposure: 'none',
    idempotent: true,
  }),
}
