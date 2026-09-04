# Contributing to Klopt

## Licence and sign-off

Klopt is Apache-2.0. Section 5 of that licence already aligns inbound
contributions with outbound licensing, so there is **no CLA**. What there is, is
a **DCO sign-off**: every commit carries a `Signed-off-by` line certifying you
have the right to submit the work.

```
git commit -s -m "ledger: reject unbalanced entries at the database level"
```

Read the certificate you are signing at <https://developercertificate.org>.

## Before you open a pull request

```
pnpm install
pnpm run verify     # format, lint, typecheck, test, boundaries
```

CI runs the same command. If `verify` is green locally it will be green there.

## The rules that are not negotiable

These are enforced mechanically, so you will find out fast. They are listed here
so you find out sooner.

1. **`packages/core` imports no framework, no database and no adapter.** It is
   the part of the codebase that survives a framework change. ESLint enforces
   the boundary; see `docs/decisions/0005-domain-boundary-enforcement.md`.
2. **No `number` in the money path.** Amounts are `bigint` minor units plus a
   currency code, and cross a boundary as a decimal string. The
   `klopt/no-number-money` lint rule is a tripwire, not a proof — do not route
   around it.
3. **Every domain operation has an API route.** A contract test fails the build
   otherwise. The UI is a client of the public API, not a privileged path.
4. **Every write is idempotent**, keyed by a client-supplied idempotency key. A
   retried posting must never double-post.
5. **The journal is append-only.** Corrections are reversals. If you find
   yourself writing an `UPDATE` against a posted entry, the design is wrong.
6. **Compliance artefacts are versioned data, not code.** Taxonomies,
   schematrons and RGS schemes are loaded at runtime. A taxonomy update must be
   a data release, not a deploy.

## Commit and branch conventions

- Branches: `<area>/<short-description>`, e.g. `ledger/hash-chain`.
- Commit subjects: `<area>: <imperative summary>`, e.g. `vat: reconcile rubriek 3b against ICP`.
- One logical change per pull request. A regulated-artefact change (XAF, UBL,
  XBRL, pain.001) must include the golden-file diff, and the diff must be
  explained in the description.

## Where things go

| Change                                              | Package                     |
| --------------------------------------------------- | --------------------------- |
| Accounting rules, calculations, artefact generation | `packages/core`             |
| Tables, migrations, queries                         | `packages/db`               |
| Anything that talks to a third party                | `packages/adapters`         |
| Routes, server functions, UI, REST                  | `apps/web`                  |
| Scheduled and queued work                           | `apps/worker`               |
| Lint rules specific to this project                 | `tools/eslint-plugin-klopt` |
