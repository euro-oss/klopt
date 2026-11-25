# Browser e2e (Playwright)

## Dev server (default)

`playwright.config.ts` starts `vite dev --port 3399` unless `KLOPT_E2E_BASE_URL` points at an existing instance. That is what `pnpm test:e2e` and local runs use.

## Built server (CI main shards)

GitHub Actions runs the four **main** shard jobs against the Nitro bundle (`CI=true KLOPT_E2E_BUILT_SERVER=1 vite build`, then `node .output/server/index.mjs`) so CI does not pay Vite dev overhead on every spec. Shard builds set `__KLOPT_LAB_ROUTES__` via `vite.config.ts` so `/lab/*` fixture routes stay reachable in the built bundle without faking `import.meta.env.DEV`. Verify runs `assert-lab-build-output.ts` on the normal workspace build to ensure lab routes bake to `notFound()`. The built server runs with `NODE_ENV=test` (bundle stays production); browsers hit **self-signed HTTPS on localhost** so session cookies are `Secure`, with Playwright `ignoreHTTPSErrors: true` (CI config only). The Exact plain-http assertion runs once on vite dev in the **e2e-midnight** job.

| Piece                                   | Role                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `playwright.ci.config.ts`               | Shard job config: `https://localhost:3399`, `ignoreHTTPSErrors`                                    |
| `e2e/scripts/built-server-webserver.ts` | Starts the built server + TLS proxy; certs under `e2e/.ci-tls/` (gitignored, generated at runtime) |
| `KLOPT_E2E_BUILT_SERVER=1`              | Documented gate when running the CI config locally                                                 |

```bash
cd apps/web
CI=true KLOPT_E2E_BUILT_SERVER=1 pnpm exec vite build
export DATABASE_URL=postgres://klopt:klopt@localhost:5432/klopt
KLOPT_E2E_BUILT_SERVER=1 pnpm exec playwright test -c playwright.ci.config.ts
```

Midnight and fiscal-year jobs stay on **vite dev** (`playwright.contacts-midnight.config.ts`, `playwright.fiscal-year-booking.config.ts`) because they need non-production fake clocks or fixed `KLOPT_E2E_TODAY_ISO`.

## Simulated API latency

`KLOPT_E2E_API_DELAY_MS` and `KLOPT_E2E_API_DELAY_NON_GET_ONLY=1` still apply: delays are installed in the Playwright process via `page.route`, independent of dev vs built server.

## CI shard lists

See `ci-shards/README.md` and `test/unit/e2e-ci-shards.test.ts`.
