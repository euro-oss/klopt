# 0005. Enforce the core boundary with ESLint, not dependency-cruiser alone

Status: Accepted
Date: 2026-09-04

## Context

Requirement 11.2 says to enforce the `packages/core` framework-free boundary
"with a dependency-cruiser rule in CI, not with good intentions". Two practical
problems with dependency-cruiser as the only mechanism in a pnpm workspace:

1. Workspace dependencies resolve through a symlink into the package's `exports`,
   which point at `dist/`. Cross-package edges are therefore invisible until a
   build has run, which makes the check ordering-sensitive and easy to get
   silently wrong.
2. It reasons about the resolved module graph, so an `import type` — which
   compiles away — is not obviously a violation, even though a core module
   importing a Drizzle type is exactly the coupling we are trying to prevent.

## Decision

Split the enforcement by shape:

- **ESLint** (`@typescript-eslint/no-restricted-imports`) owns the
  specifier-shaped rules: who may import whom, by package name. It sees
  `import type`, needs no build, and reports in the editor as you type.
- **dependency-cruiser** owns the graph-shaped rules that ESLint cannot see:
  cycles, orphans, production code reaching a devDependency, phantom
  dependencies.

Both run in `pnpm run verify` and in CI, dependency-cruiser after the build.

The enforced layering:

| Package             | May not import                                   |
| ------------------- | ------------------------------------------------ |
| `packages/core`     | any UI framework, `@klopt/db`, `@klopt/adapters` |
| `packages/db`       | any UI framework, `@klopt/adapters`              |
| `packages/adapters` | any UI framework, `@klopt/db`                    |
| `apps/worker`       | `react`, `@tanstack/react-start`                 |

## Consequences

- Two tools instead of one, with two places to add a rule. The split is by rule
  shape, so which one to reach for is not usually ambiguous.
- The worker rule is the one people will be surprised by. It is the point of the
  whole layout: scheduled work runs outside a request, and if posting logic
  lives in a server function it is unreachable there.
