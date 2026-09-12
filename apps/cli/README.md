# klopt

The operator's surface (spec 10.4). A thin client over the same public API the
web app and the MCP server use — there is no database handle in this package
and the lint config forbids adding one.

```sh
klopt login --email you@example.nl --url https://books.example.nl
klopt check
klopt export --year 2026 --out auditfile.xml
klopt bank-import --file statement.mt940 --commit
klopt webhooks-replay
klopt events
```

## The six things spec 10.4 says you need at 23:00

| You need                 | Command           |
| ------------------------ | ----------------- |
| create the first user    | `login`           |
| run a backup             | `export`          |
| export an XAF            | `export`          |
| replay a webhook         | `webhooks-replay` |
| import a statement       | `bank-import`     |
| the reconciliation check | `check`           |

`login` on an empty instance creates the first user, because signing in with an
address nobody has used creates the account — the same path the sign-in screen
takes. With no mail server configured the code is in the server log, which is
what a fresh install has.

## Credentials

`KLOPT_TOKEN` wins when it is set; otherwise the session from `klopt login`,
stored `0600` at `$XDG_CONFIG_HOME/klopt/session.json`.

A machine should run as itself with a scoped token, not as whoever last logged
in on that host — which is why the environment beats the file rather than the
other way round.

## Exit codes

`check` is meant for cron, so they mean something:

- **0** — fine
- **1** — the thing failed: a broken hash chain, a trial balance that does not
  net to zero, a refused request
- **2** — you asked wrongly: a missing option, an unknown command, an ambiguous
  account
- **77** — the credentials were refused (`EX_NOPERM`), so a script can tell
  "the token is wrong" from "the request was"

Unmapped RGS accounts are reported but do not fail. They are incomplete
reporting rather than a wrong number, and exiting 1 for them would train
somebody to ignore the exit code of the one command whose job is to be
believed.

## No operation exists only here

Spec 10.4's rule. Each command declares the domain operations it calls, and
`test/registry.test.ts` checks every id against `OPERATIONS` in `@klopt/core`.
A command that did something the API cannot would have nothing to declare.
