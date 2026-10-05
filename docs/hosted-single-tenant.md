# Hosted single-tenant layout

Operator files for running **one** Klopt administration on **one** dedicated
server. This is not a public product, not a control plane, and not
multi-tenant.

The working copy lives in [`deploy/hosted/`](../deploy/hosted/), with the
procedure in [`deploy/hosted/RUNBOOK.md`](../deploy/hosted/RUNBOOK.md). The
first instance of this layout is Hidde's. DNS for that instance is Cloudflare
**DNS only / grey cloud**; TLS terminates on Scaleway AMS via Caddy — see the
runbook DNS checklist.

Milestone: [hosted-eu](https://github.com/euro-oss/klopt/milestone/3).
