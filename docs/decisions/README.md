# Architecture decision records

One file per decision, numbered, never edited after acceptance — a decision that
turns out wrong gets a new record that supersedes it. This is the same rule the
journal follows, for the same reason.

Each row is taken from that record's `# NNNN.` heading and its `Status:` line.
When you add a record, add its row; when a record is superseded, change its
status here to match the file.

| #                                                                          | Decision                                                                             | Status   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| [0001](0001-apache-2-0-licence.md)                                         | Apache-2.0, no CLA, no enterprise edition                                            | Accepted |
| [0002](0002-typescript-5-not-7.md)                                         | Pin TypeScript 5.9, not the 7.x that `latest` points at                              | Accepted |
| [0003](0003-tanstack-start-version-policy.md)                              | Track TanStack Start stable, pin exact, upgrade deliberately                         | Accepted |
| [0004](0004-money-representation.md)                                       | bigint minor units in process, decimal string on the wire                            | Accepted |
| [0005](0005-domain-boundary-enforcement.md)                                | Enforce the core boundary with ESLint, not dependency-cruiser alone                  | Accepted |
| [0006](0006-tenancy-and-schema-layout.md)                                  | Named Postgres schema from the first table, RLS-ready                                | Accepted |
| [0007](0007-postgres-only-infrastructure.md)                               | Postgres is the queue, the search index and the cache                                | Accepted |
| [0008](0008-adapter-ports-deferred.md)                                     | Adapter port signatures wait for the domain types                                    | Accepted |
| [0009](0009-balance-per-currency.md)                                       | Balance per currency, qualified                                                      | Accepted |
| [0010](0010-hand-written-migrations.md)                                    | One migration runner for generated and hand-written SQL                              | Accepted |
| [0011](0011-rgs-as-reference-data.md)                                      | RGS ships as generated reference data, not as code                                   | Accepted |
| [0012](0012-xaf-two-layer-validation.md)                                   | XAF is validated twice, by two different things                                      | Accepted |
| [0013](0013-ui-comes-in-now.md)                                            | The UI arrives with M0's screens, then per milestone                                 | Accepted |
| [0014](0014-entity-provisioning.md)                                        | An administration is created by a signed-in human, under an id they bring            | Accepted |
| [0015](0015-invitations-are-addresses.md)                                  | An invitation is an address, not a token                                             | Accepted |
| [0016](0016-ubl-generation-before-schematron.md)                           | UBL generation lands before schematron execution, and nothing sends until it arrives | Accepted |
| [0017](0017-schematron-in-process.md)                                      | The schematron runs in process, as data, on an XPath 3.1 engine                      | Accepted |
| [0018](0018-dunning-stage-is-derived.md)                                   | A dunning stage is derived, and a failed send is a record                            | Accepted |
| [0019](0019-matching-suggests.md)                                          | The matcher suggests, and the confirmation is what teaches it                        | Accepted |
| [0020](0020-payments-need-two-people.md)                                   | A payment file needs two people, and neither of them can be a script                 | Accepted |
| [0021](0021-a-journal-line-says-whether-it-is-base-or-tax.md)              | A journal line says whether it is the base or the tax                                | Accepted |
| [0022](0022-filing-soft-closes-the-period.md)                              | Filing soft-closes the period, and a correction is a suppletie                       | Accepted |
| [0023](0023-vies-proof-is-the-zero-rate.md)                                | An unproven VAT number blocks the opgaaf, and an outage is not proof                 | Accepted |
| [0024](0024-the-manual-path-is-the-default.md)                             | The manual filing path is the default, and Digipoort's signature is a seam           | Accepted |
| [0025](0025-the-supplier-is-the-authority.md)                              | On a purchase invoice the supplier is the authority, and booking precedes approval   | Accepted |
| [0026](0026-one-queue-and-the-hash-is-the-name.md)                         | One queue for everything that arrives, and the hash is the document's name           | Accepted |
| [0027](0027-scheduling-is-not-paying.md)                                   | A payment run pays suppliers, not invoices, and scheduling is not paying             | Accepted |
| [0028](0028-one-queue-two-doorways.md)                                     | Documents that arrive on their own: one queue, two doorways, at-least-once           | Accepted |
| [0029](0029-the-audit-log-has-to-be-complete-to-be-worth-anything.md)      | An audit log with a hole in it is worse than none                                    | Accepted |
| [0030](0030-retention-is-a-fact-deletion-is-a-decision.md)                 | Retention is a fact about a document; deletion is a decision somebody makes          | Accepted |
| [0031](0031-a-seal-is-small-enough-to-write-down.md)                       | A sealed snapshot is small enough to write down                                      | Accepted |
| [0032](0032-the-storage-refuses-so-the-application-need-not-be-trusted.md) | The storage refuses, so the application need not be trusted                          | Accepted |
| [0033](0033-isolation-is-a-test-not-a-habit.md)                            | Isolation is a test, not a habit                                                     | Accepted |
| [0034](0034-one-login-many-administrations.md)                             | One login, many administrations                                                      | Accepted |
| [0035](0035-an-agent-is-a-client-not-a-shortcut.md)                        | An agent is a client, not a shortcut                                                 | Accepted |
| [0036](0036-oauth-is-a-way-to-get-a-token.md)                              | OAuth is a way to get a token, not a second way in                                   | Accepted |
| [0037](0037-a-token-you-cannot-revoke.md)                                  | A token you cannot revoke                                                            | Accepted |
| [0038](0038-dutch-is-the-source-english-is-a-translation.md)               | Dutch is the source, English is a translation                                        | Accepted |
| [0039](0039-erasing-a-contact-without-falsifying-the-books.md)             | Erasing a contact without falsifying the books                                       | Accepted |
| [0040](0040-authentication-leaves-a-trace-and-has-a-ceiling.md)            | Authentication leaves a trace, and has a ceiling                                     | Accepted |
| [0041](0041-a-module-contract-with-teeth.md)                               | A module contract with teeth                                                         | Accepted |
| [0042](0042-headless-is-a-switch-not-a-second-build.md)                    | Headless is a switch, not a second build                                             | Accepted |
| [0043](0043-the-document-is-generated-or-it-is-fiction.md)                 | The document is generated, or it is fiction                                          | Accepted |
| [0044](0044-the-response-schema-is-the-return-type.md)                     | The response schema is the return type                                               | Accepted |
| [0045](0045-the-server-sends-a-code-the-reader-picks-the-words.md)         | The server sends a code, the reader picks the words                                  | Accepted |
| [0046](0046-the-sentence-has-a-name-of-its-own.md)                         | The sentence has a name of its own                                                   | Accepted |
| [0047](0047-a-finding-names-its-own-sentence.md)                           | A finding names its own sentence                                                     | Accepted |
| [0048](0048-an-import-report-a-script-can-read.md)                         | An import report a script can read                                                   | Accepted |
| [0049](0049-signing-out-is-worth-writing-down.md)                          | Signing out is worth writing down                                                    | Accepted |
| [0050](0050-drive-the-reads-from-the-manifest.md)                          | Drive the reads from the manifest                                                    | Accepted |
| [0051](0051-five-more-events-and-a-check-that-they-exist.md)               | Five more events, and a check that they exist                                        | Accepted |
| [0052](0052-a-tag-you-can-hold-an-edit-to.md)                              | A tag you can hold an edit to                                                        | Accepted |
| [0053](0053-a-column-that-finally-means-something.md)                      | A column that finally means something                                                | Accepted |
| [0054](0054-a-batch-is-a-statement-about-transactions.md)                  | A batch is a statement about transactions                                            | Accepted |
| [0055](0055-a-word-a-figure-and-a-route-to-each.md)                        | A word, a figure, and a route to each                                                | Accepted |
| [0056](0056-a-gate-most-requests-reach-is-not-a-gate.md)                   | A gate most requests reach is not a gate                                             | Accepted |
| [0057](0057-a-hundred-and-nine-of-a-hundred-and-nine.md)                   | A hundred and nine of a hundred and nine                                             | Accepted |
| [0058](0058-a-seal-somebody-else-has-seen.md)                              | A seal somebody else has seen                                                        | Accepted |

## Template

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context

What forced a decision.

## Decision

What was decided, in the active voice.

## Consequences

What this makes easy, what it makes hard, and what it forecloses.
```
