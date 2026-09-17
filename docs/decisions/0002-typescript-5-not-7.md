# 0002. Pin TypeScript 5.9, not the 7.x that `latest` points at

Status: Accepted
Date: 2026-09-04

## Context

`npm view typescript version` returns 7.0.2 — the native compiler. `typescript-eslint`
8.69.0 declares a peer range of `>=4.8.4 <6.1.0`, so type-aware linting does not
work on TypeScript 6 or 7 today.

Type-aware linting is not optional here. The rules that enforce the money path
and the `packages/core` boundary need type information, and those rules are the
main mechanical defence for two of the product principles.

## Decision

Pin `typescript@5.9.3` exactly, everywhere in the workspace.

Revisit when `typescript-eslint` ships a release whose peer range includes 7.x.
The upgrade is then a single-line change plus a CI run, because the version is
pinned in one place per package.

## Consequences

- Slower builds than the native compiler would give. Acceptable at this size.
- Language features from TypeScript 6 and 7 are unavailable. Nothing planned
  depends on one.
- The repository is out of step with `latest`, so a contributor running
  `pnpm add -D typescript` will pull 7.x and break lint. The pin plus this
  record is the answer to the confused issue that follows.

Note that the official TanStack Start example already installs both compilers
side by side (`@typescript/native` alongside a 6.x `typescript`). We are not
copying that: two compilers is a debugging cost we have not earned.
