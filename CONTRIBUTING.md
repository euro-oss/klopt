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
pnpm run verify     # format, build, lint, typecheck, test, boundaries
```

CI runs the same command. If `verify` is green locally it will be green there.

It needs Postgres — `docker compose up -d postgres` and
`pnpm --filter @klopt/db run migrate` — and nothing else. Object storage is not
a test dependency: the S3 store's specs run against an S3-compatible
object-lock bucket inside the test process, and against MinIO only when you ask
for it with `KLOPT_S3_ENDPOINT` ([ADR
0059](docs/decisions/0059-a-bucket-close-enough-to-test-against.md)).

## Pull requests

1. Branch from current `main` as `<area>/<short-description>` (see conventions
   below).
2. Open the PR against `main` and fill the template. One logical change per PR.
3. Every commit on the branch must carry a DCO sign-off (`git commit -s`).
4. Wait for CI on the tip: `verify` (Node 24), `verify` (Node 26), `artefacts`,
   and `e2e`. A red tip is not ready for review, let alone merge.
5. A regulated-artefact change (XAF, UBL, XBRL, pain.001, CAMT, taxonomies,
   schematrons) must include the golden-file or data diff, explained in the
   description.

### Review expectations

- Expect at least one review from an **appointed maintainer** before anything
  reaches `main`. A thumbs-up from someone who is not appointed does not count.
- Reviewers check the non-negotiable rules below, the DCO line on every commit,
  and CI green on the tip. Regulated-artefact PRs need a maintainer who owns
  that part of the compliance calendar (see `GOVERNANCE.md` and
  `MAINTAINERS.md`).
- Answer review comments, or say why not. Prefer additive commits while review
  is open; rebase when the reviewer asks for a clean history against `main`.

### Who may merge

**Only appointed maintainers may merge pull requests into `main`.**

Anyone may open a PR. Opening a PR, getting CI green, or collecting informal
review does **not** grant merge rights. There is no “open merge” implication
for a public or soon-public repository.

- **People / roles:** listed in [`MAINTAINERS.md`](MAINTAINERS.md) when
  assigned. Cross-link only — do not infer merge rights from an empty or
  interim row.
- **GitHub accounts that may press Merge:** **TBD — pending Hidde’s pick** of
  who holds merge rights on this repository (likely only him for now). Do not
  treat invented or guessed `@username` values as final.
- **Enforcement:** GitHub branch protection / ruleset on `main`. Eng cannot
  always apply org settings; the click-through checklist lives in
  [`docs/github-branch-protection.md`](docs/github-branch-protection.md) and
  must be applied by someone with admin on the repo (Hidde or delegate).

Until those accounts are named **and** the ruleset is applied, treat merge to
`main` as closed to everyone who is not already an appointed maintainer with
explicit GitHub merge permission.

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

## Related

- Governance and roles: [`GOVERNANCE.md`](GOVERNANCE.md)
- Appointed maintainers (when filled): [`MAINTAINERS.md`](MAINTAINERS.md)
- Branch-protection checklist for `main`:
  [`docs/github-branch-protection.md`](docs/github-branch-protection.md)
- Security reports: [`SECURITY.md`](SECURITY.md)
