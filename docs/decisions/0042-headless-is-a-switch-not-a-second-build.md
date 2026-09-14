# 0042. Headless is a switch, not a second build

Status: Accepted
Date: 2026-09-14

## Context

Spec 10.1, the last unbuilt sentence of the deployment section:

> `klopt serve --headless` starts the API and the worker with no web app
> mounted. A separate slimmer container image ships without the UI bundle.

Two things, and they are not the same thing. The first is a runtime mode: an
instance that answers machines and refuses browsers. The second is an artefact:
an image that does not contain the UI it is refusing to serve. A mode without
the image is a promise; an image without the mode serves an HTML shell whose
scripts 404, which is worse than either.

## The mode is one middleware and one variable

`apps/web/src/server-middleware/headless.ts` is thirty lines. With
`KLOPT_HEADLESS=1`, any path that is not `/api/` or `/.well-known/` gets a 404
problem document naming the reason; without it, the middleware returns
`undefined` and nothing changes.

Middleware rather than a route check, because a route check can only refuse the
routes this build happens to have. A new page added in six months is refused by
the middleware on the day it is written and would have been served by the route
check until somebody remembered.

Two prefixes, both ending in a slash. `/api/` is the versioned API, the auth
endpoints and the MCP server; `/.well-known/` is OAuth discovery, which is how
an agent finds the authorisation server, and an agent is exactly who is left
when the UI is gone. The trailing slash is load-bearing: without it a route
named `/apiary` is served by a build with no UI in it.

## The image is two targets in one Dockerfile

`docker build -t klopt .` gives the full image; `--target headless` gives the
other. They share every layer but the last, which is the whole of the
difference: the headless target copies `.output/server` and the full target
copies `.output`, and `.output/public` — the client bundle — is what that
omits.

Both set `KLOPT_SERVER_ENTRY` and `KLOPT_WORKER_ENTRY`, so `klopt serve` is
told where the two processes live rather than searching for them. An image that
declares its own layout is one the CLI cannot be wrong about.

### The build tools do not travel

A naive two-stage build ships half a gigabyte of Rolldown, esbuild,
lightningcss, Prettier, drizzle-kit and Playwright into a container whose job
is to answer HTTP requests. Re-running `pnpm install --prod` in the build stage
does not remove them: pnpm's filters select _importers_, not store entries, and
the virtual store still holds everything the lockfile mentions for every
workspace member. Measured, on this repository: 915 MB.

Most of the excess arrives through optional peer dependencies, which this
workspace installs (`autoInstallPeers: true`). `better-auth` names
`drizzle-kit`, `kysely`, `pg`, `react`, `react-dom`, `@tanstack/react-start`
and `vitest` as peers so that it can adapt to whichever of them you brought. We
brought drizzle-orm and postgres; pnpm links the other six anyway, and through
`@tanstack/react-start` comes Vite, and through Vite comes the rest.

`tools/container/prune-store.mjs` walks out from the packages that actually run
— worker, CLI, the three `@klopt` packages — following each manifest's
`dependencies`, `optionalDependencies` and its non-optional peers, and deletes
every store entry the walk never reaches. It removed 148 of 269 entries and
took the image from 606 MB to 382 MB.

This can break a package that requires something it never declared, which works
under pnpm only by accident of the hoisted fallback in `.pnpm/node_modules` —
not a root here. It fails at boot rather than quietly, and the walk-through
below is what holds it.

`pnpm deploy` would be the intended tool and does not help: `--legacy` produced
247 MB for the worker alone, and the injected variant needs
`inject-workspace-packages=true` set for the whole workspace, which would make
`@klopt/*` copies rather than symlinks and break the edit-rebuild loop the rest
of the repository depends on.

## What "slimmer" honestly amounts to

**382 MB against 380 MB.** Two megabytes.

That is the honest number and it is not the one the spec sentence implies.
`.output/public` is 1.2 MB of an 11 MB build output, and the layers underneath
it — Node, the pruned dependency tree, the server bundle — are identical.

The reason it is not more: the _server_ bundle still contains the SSR code for
every route, including the ones the middleware now refuses. Dropping them needs
the route generator to skip those files, which the TanStack Start plugin
exposes as `router.routeFileIgnorePattern`. It is in the type definitions, the
config branch was confirmed to run, and the route tree regenerated — and even a
pattern as blunt as `contacts` excluded nothing. This version accepts the
option and ignores it. Until that works, or until the client build can be
turned off for a second build of the same source, headless saves the client
bundle and nothing else.

The two-megabyte image is still worth shipping. Not for the disk: for the
property that the UI is not _there_. An instance that cannot serve a page
because the page does not exist is a different claim from one that has the page
and has been asked not to.

## The wart that was left alone

Nitro composes its own public-asset middleware ahead of ours. A request for a
path the asset manifest knows — `/assets/index-D20a_0xX.js` — is answered
before the headless check runs, and in the headless image the file is absent,
so it is an ENOENT and a 500 with a stack trace rather than the 404 problem
document. Paths the manifest does not know, including `/favicon.ico`, reach the
middleware and are refused correctly.

Fixing it means reordering `h3App["~middleware"]` from a Nitro plugin — a
tilde-prefixed private field on a beta — or a second build that never emits a
client manifest, which is the same missing capability as above. Neither is
worth it for a path only reachable by someone holding an asset URL taken from a
different instance, since a headless instance never emits one. It is written
down in `headless.ts` and in `vite.config.ts` so the next person meets it as a
known thing rather than a mystery.

## `klopt serve` runs two processes

The worker is not on the API's event loop, and headless mode is not the reason:
the worker polls mailboxes, pulls ten years of documents out of Exact, and
seals a book year at four in the morning. A long job sharing a loop with a
request makes the request late.

So `serve` spawns both, inherits their stdio into one stream, forwards SIGINT
and SIGTERM to both, and stops the other when either exits. That last rule is
what makes a restart policy work: a container serving requests for a week with
a dead worker is the failure nobody notices, and it is the one that loses an
invoice.

It finds the worker by path, not by `require.resolve`. Depending on
`@klopt/worker` would pull a database driver into the CLI's tree to run a file
it only ever spawns, and the lint rule that keeps `@klopt/db` out of the CLI
would then be the only thing standing between a future contributor and a direct
query. Not depending on it at all is the version that survives.

Every candidate path names its package. A bare `<cwd>/dist/main.js` resolves,
run from `apps/cli`, to the CLI itself — spawned as the worker, printing its
usage, exiting 0, and taking the API with it. There is a test.

`serve` is also the one command in the registry that reaches no `/api/v1`
operation and is not an auth command, so `NOT_DOMAIN_OPERATIONS` gained a third
entry with its reason. Spec 10.4's rule — no operation exists only in the CLI —
is unaffected: `serve` manages processes and reaches nothing.

## The walk-through

Against the real Postgres and MinIO, both images built and run:

|                                             | headless                    | full                    |
| ------------------------------------------- | --------------------------- | ----------------------- |
| `GET /`                                     | 404 problem+json            | 200                     |
| `GET /sign-in`                              | 404 problem+json            | 200                     |
| `GET /api/v1/events`                        | 401                         | 401                     |
| `GET /.well-known/oauth-protected-resource` | 200                         | 200                     |
| `GET /favicon.ico`                          | 404 problem+json            | —                       |
| the seven assets `/sign-in` references      | absent                      | all 200                 |
| worker                                      | `started with 5 job(s)`     | `started with 5 job(s)` |
| `docker stop`                               | drains and exits 0 in 1.2 s | —                       |

`docker run klopt migrate` reported `up to date (29 applied)`, and
`docker run --entrypoint klopt klopt help` printed the command list — the two
things an operator does at 23:00 (spec 10.4) work in the image without knowing
where anything lives.

## Consequences

- Headless is a runtime switch. The same build serves both images, so there is
  no second artefact to keep in step and no way for the API to differ between
  them.
- The headless image is 2 MB smaller, not meaningfully smaller. Written down
  here rather than implied by the flag's existence.
- `prune-store.mjs` is load-bearing for image size and can break on an
  undeclared dependency. It breaks loudly, at boot, and the walk-through above
  is the gate.
- A known asset URL against a headless instance returns 500. Nobody who only
  ever talked to that instance has one.
- If `routeFileIgnorePattern` starts working, or the client build becomes
  skippable, the headless image can get genuinely smaller with no change to the
  middleware, the CLI, or the Dockerfile's structure — only to what the
  headless target copies.
