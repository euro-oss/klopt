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

  postJournalEntries: defineOperation({
    id: 'ledger.postJournalEntries',
    kind: 'write',
    permission: 'ledger:post',
    summary:
      'Post many journal entries, each in its own transaction, with a result per entry. ' +
      'Supports dry run.',
    // Same category as posting one. A batch is not a lighter act because it is
    // larger — it is the same act repeated, and an agent proposes it.
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

  listJournals: defineOperation({
    id: 'ledger.listJournals',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'The dagboeken this administration posts through.',
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

  /**
   * The audit log, read and exported (spec 7.6).
   *
   * `ledger:export` rather than `ledger:read`, and deliberately: the log holds
   * who did what and from which address, which is a different question from
   * what the books say. A bookkeeper reads the books; reading the record of
   * everybody's actions is an audit, and audits have their own permission.
   */
  listAuditLog: defineOperation({
    id: 'audit.list',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'Who did what, when, from where. Newest first, filterable.',
    agentExposure: 'read',
    idempotent: true,
  }),

  /**
   * The bewaarplicht (spec 7.6).
   *
   * Reading is an export-level question and changing it is its own permission,
   * because deleting statutory records is the only action here that destroys
   * evidence rather than reversing an entry.
   *
   * `agentExposure: 'none'` throughout, including the read. An agent that can
   * see which documents are deletable is an agent that can propose deleting
   * them, and there is no version of that proposal anybody wants in a queue.
   */
  getRetention: defineOperation({
    id: 'retention.get',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'What is kept how long, what is held, and what could be deleted.',
    agentExposure: 'none',
    idempotent: true,
  }),

  setLegalHold: defineOperation({
    id: 'retention.setLegalHold',
    kind: 'write',
    permission: 'retention:manage',
    summary: 'Suspend deletion for the administration or for named documents, with a reason.',
    agentExposure: 'none',
    idempotent: true,
  }),

  setRetentionClass: defineOperation({
    id: 'retention.setClass',
    kind: 'write',
    permission: 'retention:manage',
    summary: 'Ten years rather than seven, for documents about onroerend goed.',
    agentExposure: 'none',
    idempotent: true,
  }),

  listEvents: defineOperation({
    id: 'events.list',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'The event stream since a cursor. What a self-hoster behind NAT polls instead of receiving webhooks.',
    // An agent asking "what changed" is a reasonable thing to want, and every
    // event is a reference the agent must still be allowed to fetch.
    agentExposure: 'read',
    idempotent: true,
  }),

  listWebhooks: defineOperation({
    id: 'webhooks.list',
    kind: 'read',
    permission: 'tokens:manage',
    summary:
      'The subscriptions on this administration, how far behind each is, and recent attempts.',
    agentExposure: 'none',
    idempotent: true,
  }),

  createWebhook: defineOperation({
    id: 'webhooks.create',
    kind: 'write',
    permission: 'tokens:manage',
    summary: 'Subscribe a URL to the event stream. The signing secret is shown once.',
    agentExposure: 'none',
    idempotent: true,
  }),

  deleteWebhook: defineOperation({
    id: 'webhooks.delete',
    kind: 'write',
    permission: 'tokens:manage',
    summary: 'Stop sending to a URL, and forget its secret.',
    agentExposure: 'none',
    idempotent: true,
  }),

  replayWebhook: defineOperation({
    id: 'webhooks.replay',
    kind: 'write',
    permission: 'tokens:manage',
    summary:
      'Send everything again from a point in the stream, or switch a disabled endpoint back on.',
    agentExposure: 'none',
    idempotent: true,
  }),

  pseudonymiseContact: defineOperation({
    id: 'retention.pseudonymiseContact',
    kind: 'write',
    permission: 'retention:manage',
    summary:
      "Erase a contact's personal data on an erasure request. The ledger, the invoices and the documents are untouched.",
    // Never. An erasure is irreversible and answers a legal request made to a
    // human; an assistant offering to do it is offering the wrong thing.
    agentExposure: 'none',
    // The second run finds the contact already pseudonymised and changes
    // nothing, which is what makes a retried request safe.
    idempotent: true,
  }),

  deleteDocuments: defineOperation({
    id: 'retention.deleteDocuments',
    kind: 'write',
    permission: 'retention:manage',
    summary:
      'Delete documents whose bewaarplicht has run out. Deliberate, audited, and refused for anything held.',
    agentExposure: 'none',
    // Idempotent because the second run finds them already deleted and refuses
    // rather than deleting something else. Which is what makes a half-finished
    // run safe to repeat.
    idempotent: true,
  }),

  /**
   * Sealed snapshots (spec 7.6).
   *
   * Sealing is a `write` and reads on `ledger:read`, which is deliberately
   * asymmetric: producing the artefact is a compliance act with a permission
   * behind it, and *seeing that one exists* is something anybody looking at the
   * books should be able to do. A seal nobody can see is a seal nobody checks.
   */
  sealSnapshot: defineOperation({
    id: 'snapshot.seal',
    kind: 'write',
    permission: 'ledger:export',
    summary:
      'Seal a book year: the chain head, a manifest of document hashes and the auditfile, under one hash.',
    agentExposure: 'none',
    // The seal covers its own timestamp, so two seals of the same year are two
    // distinct artefacts rather than a duplicate — which is what makes a
    // scheduled reseal meaningful and a retry harmless.
    idempotent: true,
  }),

  listSnapshots: defineOperation({
    id: 'snapshot.list',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Every sealed snapshot, its seal and what checking it found.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getSnapshotManifest: defineOperation({
    id: 'snapshot.getManifest',
    kind: 'read',
    permission: 'ledger:export',
    summary: 'The manifest text a seal is computed over — the artefact itself.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getSnapshotTimestamp: defineOperation({
    id: 'snapshot.getTimestamp',
    kind: 'read',
    permission: 'ledger:export',
    summary:
      "The timestamp authority's own reply about this seal, as it arrived — the file `openssl ts -verify` takes.",
    agentExposure: 'read',
    idempotent: true,
  }),

  verifySnapshot: defineOperation({
    id: 'snapshot.verify',
    kind: 'write',
    permission: 'ledger:export',
    summary:
      'Check a snapshot against the administration now, and record what was found. Growth is not drift.',
    agentExposure: 'none',
    idempotent: true,
  }),

  exportAuditLog: defineOperation({
    id: 'audit.export',
    kind: 'read',
    permission: 'ledger:export',
    summary:
      'The audit log for a period as JSON Lines or CSV — the artefact an inspector is handed.',
    agentExposure: 'read',
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

  getContact: defineOperation({
    id: 'sales.getContact',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'One contact with its address, for correcting it.',
    agentExposure: 'read',
    idempotent: true,
  }),

  updateContact: defineOperation({
    id: 'sales.updateContact',
    kind: 'write',
    permission: 'ledger:configure',
    summary:
      'Correct a contact. Master data, so it is changed in place; documents already issued keep what they said.',
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
    permission: 'ledger:draft',
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

  /**
   * API tokens and the OAuth clients that hold them.
   *
   * `tokens:manage` has existed since the roles were written and nothing used
   * it, which meant there was no way to issue a token or revoke one except by
   * hand in the database — while the README told people to do both under
   * Toegang.
   *
   * `agentExposure: 'none'`, and not arguable: a token is the thing an agent
   * authenticates with, and an agent that can mint tokens can mint one with
   * permissions it was not given.
   */
  listTokens: defineOperation({
    id: 'tokens.list',
    kind: 'read',
    permission: 'tokens:manage',
    summary: 'Every API token on these books: what it may do, who holds it, when it was last used.',
    agentExposure: 'none',
    idempotent: true,
  }),

  issueToken: defineOperation({
    id: 'tokens.issue',
    kind: 'write',
    permission: 'tokens:manage',
    summary: 'Issue an API token. The secret is shown once and never again.',
    agentExposure: 'none',
    idempotent: true,
  }),

  revokeToken: defineOperation({
    id: 'tokens.revoke',
    kind: 'write',
    permission: 'tokens:manage',
    summary: 'Revoke a token. Takes effect on the next request that presents it.',
    agentExposure: 'none',
    idempotent: true,
  }),

  revokeOAuthClient: defineOperation({
    id: 'tokens.revokeClient',
    kind: 'write',
    permission: 'tokens:manage',
    summary:
      'Withdraw an authorised app: revoke its live tokens and require fresh consent before it gets more.',
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

  previewRun: defineOperation({
    id: 'payments.previewRun',
    kind: 'read',
    permission: 'payments:prepare',
    summary:
      'What a payment run would pay: one instruction per supplier, netted for credit notes, with what each settles.',
    agentExposure: 'read',
    idempotent: true,
  }),

  addApprovedInvoices: defineOperation({
    id: 'payments.addApprovedInvoices',
    kind: 'write',
    permission: 'payments:prepare',
    summary:
      'Put every approved, unpaid purchase invoice into a draft batch, recording which invoices each instruction settles.',
    agentExposure: 'proposal',
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

/**
 * Purchase invoices (spec 15, M4).
 *
 * `book` is the write that puts the invoice in the books, and `transition`
 * carries approval, dispute and resolution. Approval is not an agent's call:
 * the point of an authorisation is that somebody looked, so it is `none` rather
 * than `proposal`.
 */
export const purchaseOperations: Readonly<Record<string, OperationDefinition>> = {
  listInvoices: defineOperation({
    id: 'purchase.listInvoices',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Purchase invoices with what is still outstanding on each.',
    agentExposure: 'read',
    idempotent: true,
  }),

  getInvoice: defineOperation({
    id: 'purchase.getInvoice',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'One purchase invoice, its lines, and everything wrong with it.',
    agentExposure: 'read',
    idempotent: true,
  }),

  captureInvoice: defineOperation({
    id: 'purchase.captureInvoice',
    kind: 'write',
    permission: 'ledger:draft',
    summary:
      'Capture a supplier invoice as a draft. Its stated totals are recorded as given and verified, never recomputed.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  bookInvoice: defineOperation({
    id: 'purchase.bookInvoice',
    kind: 'write',
    permission: 'ledger:post',
    summary:
      'Post a captured invoice to the ledger. The liability and the deductible VAT are recognised at the invoice date.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  transitionInvoice: defineOperation({
    id: 'purchase.transitionInvoice',
    kind: 'write',
    permission: 'purchase:approve',
    summary: 'Approve, dispute or resolve a purchase invoice. Approval gates payment.',
    // An authorisation is somebody looking. A scheduled job is not.
    agentExposure: 'none',
    idempotent: true,
  }),

  getCreditorAgeing: defineOperation({
    id: 'purchase.getCreditorAgeing',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'Aged creditors, bucketed by how overdue each invoice is, with the subledger reconciled to its control account.',
    agentExposure: 'read',
    idempotent: true,
  }),
}

/**
 * The purchase inbox (spec 6, 7.5).
 *
 * `receiveDocument` is how everything gets in — an upload, an email body, a
 * Peppol delivery — and it is one operation rather than three because the queue
 * is one queue. What differs between the sources is who calls it.
 */
export const inboxOperations: Readonly<Record<string, OperationDefinition>> = {
  receiveDocument: defineOperation({
    id: 'inbox.receiveDocument',
    kind: 'write',
    permission: 'ledger:post',
    summary:
      'Take a document into the purchase inbox. Stored content-addressed, read if it can be read, matched to a supplier if it identifies one.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  listItems: defineOperation({
    id: 'inbox.listItems',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'What has arrived and not yet been dealt with.',
    agentExposure: 'read',
    idempotent: true,
  }),

  draftFromItem: defineOperation({
    id: 'inbox.draftFromItem',
    kind: 'write',
    permission: 'ledger:draft',
    summary: 'Turn an arrival into a purchase draft, with the original document attached to it.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  discardItem: defineOperation({
    id: 'inbox.discardItem',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Set an arrival aside, with a reason. The document itself is kept.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  getDocument: defineOperation({
    id: 'inbox.getDocument',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'The stored bytes of a source document.',
    agentExposure: 'read',
    idempotent: true,
  }),

  listSources: defineOperation({
    id: 'inbox.listSources',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'The mailboxes and access points this administration receives documents on.',
    agentExposure: 'read',
    idempotent: true,
  }),

  addSource: defineOperation({
    id: 'inbox.addSource',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Configure a mailbox or a drop directory to take documents from.',
    // Not exposed to an agent at all: this holds a credential, and an agent
    // proposing "connect this mailbox with this password" is not a proposal
    // anybody can meaningfully review.
    agentExposure: 'none',
    idempotent: true,
  }),

  removeSource: defineOperation({
    id: 'inbox.removeSource',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Stop taking documents from a source. What already arrived is untouched.',
    agentExposure: 'none',
    idempotent: true,
  }),

  pollSource: defineOperation({
    id: 'inbox.pollSource',
    kind: 'write',
    permission: 'ledger:post',
    summary: 'Take whatever is waiting at a source now, rather than at the next scheduled run.',
    agentExposure: 'none',
    // Idempotent without needing a key: the arrival's external id is what makes
    // it so. Polling twice files nothing the first poll already took, which is
    // the same property the worker's schedule relies on every five minutes.
    idempotent: true,
  }),
}

/**
 * Migrating out of Exact Online (spec 13).
 *
 * "Adoption is gated by getting out of the incumbent. Treat migration as a
 * product feature, not a services engagement."
 *
 * Five operations, and the shape of them is the design. Connecting, choosing a
 * division and importing are three separate acts rather than one wizard, because
 * the middle one is the one that goes wrong: a single Exact login reaches every
 * administration the user has rights to, including the practice and test ones,
 * and there is nothing about a division's data that reveals which is which
 * after the fact.
 *
 * `previewImport` is a `read` by kind even though it reaches out to Exact,
 * because it changes nothing here — and it holds `ledger:import` rather than
 * `ledger:read` because it spends somebody's API budget and reads their whole
 * administration, which is not something an auditor's token should do.
 */
export const exactOperations: Readonly<Record<string, OperationDefinition>> = {
  getConnection: defineOperation({
    id: 'exact.getConnection',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'Whether this administration is connected to Exact Online, and to which division.',
    agentExposure: 'read',
    idempotent: true,
  }),

  connect: defineOperation({
    id: 'exact.connect',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Register an Exact Online OAuth app and start the handshake.',
    // Holds a client secret. An agent proposing "connect with this secret" is
    // not a proposal anybody can review — the same reasoning as inbox.addSource.
    agentExposure: 'none',
    idempotent: true,
  }),

  completeConnection: defineOperation({
    id: 'exact.completeConnection',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Trade the authorisation code from Exact’s callback for a token pair.',
    agentExposure: 'none',
    // The code is single-use at Exact's end, which is what makes replaying this
    // safe rather than merely harmless: the second attempt gets `invalid_grant`.
    idempotent: true,
  }),

  listDivisions: defineOperation({
    id: 'exact.listDivisions',
    kind: 'read',
    permission: 'ledger:configure',
    summary: 'Every Exact administration this login can reach, with what is odd about each.',
    agentExposure: 'read',
    idempotent: true,
  }),

  chooseDivision: defineOperation({
    id: 'exact.chooseDivision',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Record which Exact administration this entity imports from.',
    agentExposure: 'none',
    idempotent: true,
  }),

  previewImport: defineOperation({
    id: 'exact.previewImport',
    kind: 'read',
    permission: 'ledger:import',
    summary:
      'What importing the chosen division would bring across, reconciled against Exact’s own trial balance.',
    agentExposure: 'read',
    idempotent: true,
  }),

  /**
   * The commit.
   *
   * `agentExposure: 'proposal'` rather than `'write'`: this creates accounts,
   * relations and an opening entry in one transaction, and an agent deciding on
   * its own which counter-account thirty thousand euro of debtors lands on is
   * not a thing this system should make easy.
   */
  runImport: defineOperation({
    id: 'exact.runImport',
    kind: 'write',
    permission: 'ledger:import',
    summary:
      'Import the chosen division: chart of accounts, relations and open items, with one opening entry.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  /**
   * The document archive, which is a job rather than a request.
   *
   * Asking is the write; the worker does the work. So the operation returns
   * the state of a run rather than the documents, and asking twice while one is
   * going joins it instead of starting a second walk.
   */
  importDocuments: defineOperation({
    id: 'exact.importDocuments',
    kind: 'write',
    permission: 'ledger:import',
    summary: 'Start pulling the Exact document archive across. Runs in the background.',
    agentExposure: 'proposal',
    idempotent: true,
  }),

  documentImportStatus: defineOperation({
    id: 'exact.documentImportStatus',
    kind: 'read',
    permission: 'ledger:read',
    summary: 'How far the document import has got, and whether it is still going.',
    agentExposure: 'read',
    idempotent: true,
  }),

  disconnect: defineOperation({
    id: 'exact.disconnect',
    kind: 'write',
    permission: 'ledger:configure',
    summary: 'Forget the Exact connection. What was already imported is untouched.',
    agentExposure: 'none',
    idempotent: true,
  }),
}

/**
 * The two questions that are not about one resource (spec 10.3).
 *
 * `search` and `explainNumber` are the tools the spec names and the MCP server
 * refused to fake. Both live here rather than in one module's group because
 * neither belongs to a module: search crosses five tables and an explanation
 * starts from a reported figure rather than from a row.
 *
 * They are REST operations first and MCP tools second, which is the
 * architectural rule of 10.3 — "the MCP server is a client of the public API,
 * not a privileged path". A capability an agent has and a script cannot get is
 * exactly the second path that rule forbids.
 */
export const discoveryOperations: Readonly<Record<string, OperationDefinition>> = {
  search: defineOperation({
    id: 'discovery.search',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'One substring search across contacts, sales invoices, purchase invoices, journal entries and documents, ranked, each result carrying the path to read it in full.',
    agentExposure: 'read',
    idempotent: true,
  }),

  explainNumber: defineOperation({
    id: 'discovery.explainNumber',
    kind: 'read',
    permission: 'ledger:read',
    summary:
      'Given a reported figure — a BTW-rubriek, an account line on a statement, an ageing bucket — the lines behind it, and whether they add up to it.',
    agentExposure: 'read',
    idempotent: true,
  }),
}
