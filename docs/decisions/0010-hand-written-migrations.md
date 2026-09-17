# 0010. One migration runner for generated and hand-written SQL

Status: Accepted
Date: 2026-09-04

## Context

The ledger's core guarantees are triggers: append-only on the journal, the
balance check, period control, chain linkage, and the gapless number allocator.
drizzle-kit does not model any of them. So hand-written SQL has to live
alongside generated SQL, and drizzle-kit's migrator only understands its own
`_journal.json`.

## Decision

A small runner in `packages/db/src/migrate.ts`, applying every `*.sql` file in
`migrations/` in filename order:

- Once each, recorded in `klopt_meta.migrations` — its own schema, so the
  bookkeeping table never appears in a dump of the books.
- One transaction per file. A failure leaves that file unapplied rather than
  half-applied.
- Statements split on `--> statement-breakpoint`, drizzle's own separator.
  Splitting on `;` would break every plpgsql body.
- **A file whose checksum changed after it was applied is a hard error.** Editing
  a migration that has already run somewhere is how two installations quietly
  diverge.
- An advisory lock, so two containers starting at once do not race.

`drizzle-kit generate` still produces the table DDL; its output is just another
file the runner picks up.

## Consequences

- `drizzle-kit migrate` must not be used. `pnpm --filter @klopt/db run migrate`
  is the only path.
- The checksum guard bites during development, when you want to fix the
  migration you wrote ten minutes ago. Before the first release the answer is to
  reset the development database; after it, the answer is a new migration.
- Rollback is not implemented, deliberately: migrations are forward-only
  (requirement 12), and the documented recovery is the pre-upgrade backup.
