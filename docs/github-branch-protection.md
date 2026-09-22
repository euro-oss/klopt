# GitHub branch protection for `main`

This is the mechanical half of the merge gate described in `CONTRIBUTING.md`.
Eng cannot always apply organisation-level settings; **Hidde (or whoever holds
admin on `euro-oss/klopt`) must click these in GitHub Settings**. Until they are
on, the prose in `CONTRIBUTING.md` is aspirational rather than enforced.

Do **not** treat an open or public repository as an open merge path. Merge to
`main` stays with appointed maintainers only.

## Where to click

Repository → **Settings** → **Rules** → **Rulesets** (preferred), or
**Branches** → branch protection rule for `main`.

A ruleset targeting `main` is enough. Keep it required, not advisory.

## Checklist (apply all)

- [ ] Target branch: `main` (include the default branch; do not leave
      protection on a stale name).
- [ ] **Restrict who can push** to `main` — empty allow-list for direct
      pushes, or only the appointed maintainer accounts once named. Prefer
      “no direct pushes; PR only”.
- [ ] **Require a pull request before merging**.
- [ ] **Required approvals: at least 1.** Approvals must come from people with
      write/maintain rights who are appointed maintainers (see
      `MAINTAINERS.md`), not from a random collaborator.
- [ ] **Dismiss stale pull request approvals when new commits are pushed.**
- [ ] **Require review from Code Owners** — leave **off** until a real
      `CODEOWNERS` file exists with appointed GitHub handles (none yet; do not
      invent them).
- [ ] **Do not allow bypassing** the above for ordinary writers. If a bypass
      list is unavoidable for emergencies, keep it to repository admins only
      and treat every bypass as exceptional.
- [ ] **Restrict who can dismiss pull request reviews** to administrators /
      appointed maintainers — not every writer.
- [ ] **Restrict who can merge** pull requests to appointed maintainer
      accounts only. GitHub usernames for that allow-list are **TBD —
      pending Hidde’s pick** (likely only him for now). Fill the list when
      those accounts are named; until then, do not widen merge rights.
- [ ] **Require status checks to pass before merging**, and list at least:
      - `verify (24)`
      - `verify (26)`
      - `artefacts`
      - `e2e`
      Require the tip of the PR to be up to date with `main` if the UI offers
      that option and it does not block legitimate work.
- [ ] **Block force pushes** to `main`.
- [ ] **Block deletions** of `main`.
- [ ] **Do not allow** “merge without waiting for status checks” or similar
      shortcuts for non-admins.

## After the checklist

1. Name the merge-capable GitHub accounts (Hidde’s pick) and put them on the
   restrict-who-can-merge allow-list.
2. Keep `MAINTAINERS.md` aligned with who is appointed (people / roles). That
   file is the human record; this ruleset is the enforcement.
3. Only then consider a minimal `CODEOWNERS` for critical paths
   (`packages/core/**`, regulated reference data, `docs/compliance-calendar.md`,
   licence / governance files). Skip `CODEOWNERS` until those GitHub handles
   exist — a placeholder file would imply review coverage that is not real.

## Out of scope here

Flipping repository visibility, inventing a `NOTICE` copyright holder, and soft
product follow-ups are separate tracks. This file is settings only.
