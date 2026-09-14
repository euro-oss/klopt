# syntax=docker/dockerfile:1

# Two images from one file (spec 10.1).
#
#   docker build -t klopt .                                # the whole thing
#   docker build -t klopt:headless --target headless .
#
# > `klopt serve --headless` starts the API and the worker with no web app
# > mounted. A separate slimmer container image ships without the UI bundle.
#
# The two share every layer but the last, so the pair costs a registry very
# little more than one of them. What "slimmer" honestly means here is recorded
# in ADR 0042: the headless image omits the client bundle, and that is all it
# omits — the server bundle still carries the SSR code for pages it will refuse
# to serve, because the route filter that would drop them is accepted and
# ignored by this version of the TanStack Start plugin.
#
# ## Why three stages rather than two
#
# `build` needs TypeScript, Vite, Rolldown, Playwright and drizzle-kit: about
# half a gigabyte of tools that must not reach a running instance. Re-running
# `pnpm install --prod` in that stage does not remove them, because pnpm's
# virtual store still holds everything the lockfile's other workspace members
# ask for. `deps` therefore installs prod-only from an empty tree, filtered to
# the three packages that actually run, and `runtime` takes its `node_modules`
# from there and only the compiled output from `build`.
#
# The layout is the repository's, on purpose. `klopt serve` then finds the same
# files in a container that it finds in a checkout, and the two entry point
# variables below mean it never has to guess at either.

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable
WORKDIR /app

# Every workspace manifest, named one by one. A `COPY . .` here would put the
# whole source tree in front of the install and throw the layer cache away on
# every edit; the lockfile and the manifests are what resolution depends on.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/cli/package.json ./apps/cli/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY examples/notifier/package.json ./examples/notifier/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY tools/eslint-plugin-klopt/package.json ./tools/eslint-plugin-klopt/
COPY tools/rgs-import/package.json ./tools/rgs-import/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Prod-only, and only for what runs: the worker, the CLI, and the migrator.
# `...` is pnpm for "and everything it depends on", which is how `@klopt/core`
# and `@klopt/adapters` get here without being named.
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @klopt/worker... --filter @klopt/cli... --filter @klopt/db...

# Filters select importers, not store entries, so the install above leaves the
# whole lockfile's worth of packages in `node_modules/.pnpm` — Rolldown, React,
# drizzle-kit, Prettier — none of which anything in a runtime image can reach.
COPY tools/container/prune-store.mjs /tmp/
RUN node /tmp/prune-store.mjs /app apps/worker apps/cli packages/db packages/core packages/adapters

# Everything both images run. Not the web server — that is the one layer they
# differ in, and it is the last thing added so that the difference is a layer
# rather than a rebuild.
FROM base AS runtime
ENV NODE_ENV=production
ENV KLOPT_SERVER_ENTRY=/app/apps/web/.output/server/index.mjs
ENV KLOPT_WORKER_ENTRY=/app/apps/worker/dist/main.js
ENV PORT=3000

COPY --from=deps /app/ ./
COPY --from=build /app/packages/adapters/dist ./packages/adapters/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
# Read at runtime, not compiled in: `migrate` applies the files, and refusing
# to run because they are absent is better than reporting a schema is current.
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/cli/dist ./apps/cli/dist

# `klopt` on the path, because an operator exec-ing into a container to run a
# backup at 23:00 should not have to know where the binary lives (spec 10.4).
RUN chmod +x /app/apps/cli/dist/main.js && ln -s /app/apps/cli/dist/main.js /usr/local/bin/klopt

COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
EXPOSE 3000
USER node

# The headless image (spec 10.1). No `.output/public`, so there is no client
# bundle in it at all, and `KLOPT_HEADLESS=1` so the server refuses a page
# rather than serving an HTML shell whose assets 404.
FROM runtime AS headless
ENV KLOPT_HEADLESS=1
COPY --from=build /app/apps/web/.output/nitro.json ./apps/web/.output/
COPY --from=build /app/apps/web/.output/server ./apps/web/.output/server

# The full image, last so that a plain `docker build` produces it.
FROM runtime AS full
COPY --from=build /app/apps/web/.output ./apps/web/.output
