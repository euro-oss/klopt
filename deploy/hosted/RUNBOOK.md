# Single-tenant Klopt on one Elastic Metal server

One administration, one box, in Amsterdam. This directory is an operator
layout for Hidde's instance. It is **not** a public hosted service, **not**
multi-tenant, and **not** a marketplace product.

Related: [hosted-eu](https://github.com/euro-oss/klopt/milestone/3). Soft
follow-ups #14 and #15 are unrelated; leave them alone.

## What runs

| Process   | Where                        | Notes                                    |
| --------- | ---------------------------- | ---------------------------------------- |
| web       | compose, image `klopt`       | `klopt serve --no-worker`                |
| worker    | compose, same image          | `node …/worker/dist/main.js`             |
| postgres  | compose, Postgres **17**     | WAL archiving via WAL-G                  |
| caddy     | compose                      | automatic HTTPS (HTTP-01)                |
| documents | Scaleway Object Storage      | object lock, compliance                  |
| backups   | **separate** Scaleway bucket | WAL-G, encrypted, object lock governance |

Nothing else is required. The restore drill uses WAL-G file storage on
isolated volumes; production backups go to Scaleway.

Resource budget encoded in `docker-compose.yml`: Postgres 2 GiB / 2 CPU, web
768 MiB / 1 CPU, worker 512 MiB / 1 CPU, Caddy 128 MiB. With the OS, Docker,
and a backup spike, plan for **~8 GiB used, 32 GiB on the SKU**.

## Create in Scaleway before first deploy

Do this in the console (or IAM + API) **before** DNS or compose. No secrets
from this repository.

### 1. Elastic Metal

- **Zone:** `nl-ams-1` or `nl-ams-2` (Amsterdam).
- **OS:** Ubuntu 24.04 LTS.
- **Recommended SKU:** **EM-A116X-SSD** — 4 cores / 4 threads, **32 GiB**
  RAM, 2 × 1.02 TB SSD, listed for Amsterdam. The compose limits above fit
  with headroom for `shared_buffers` and a WAL-G base backup; 16 GiB would
  also boot, but the smallest SSD offer Scaleway currently lists in
  Amsterdam is already 32 GiB.
- **Prefer if in stock:** **EM-A610R-NVMe** (6c/12t, 32 GiB, NVMe) — better
  for Postgres WAL, not required.
- **Skip:** EM-A215R-HDD (16 GiB, spinning disks; Amsterdam stock is the
  wrong media for WAL).
- Attach a **public IPv4**. Enable IPv6 if the box has it.
- Paste [`hardening/cloud-init.yaml`](hardening/cloud-init.yaml) as user-data
  after substituting Hidde's SSH public key. Password SSH stays off.

### 2. Object Storage buckets (two, never one)

Region **`nl-ams`**. Endpoint `https://s3.nl-ams.scw.cloud`. Object lock can
only be set **at bucket creation**.

| Bucket                  | Purpose                                           | Object lock                                                                                                                                             |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `klopt-hidde-documents` | statutory documents (`KLOPT_S3_DOCUMENTS_BUCKET`) | **Enabled**, mode **compliance**, **no default retention** (Klopt locks per object once the book year is known; a default would lock uploads too early) |
| `klopt-hidde-backups`   | WAL-G WAL + base backups only                     | **Enabled**, mode **GOVERNANCE**, default retention **30 days**                                                                                         |

Versioning comes with object lock. Do not put backups in the documents
bucket: compliance-mode document lock is the wrong policy for WAL-G's
lifecycle.

Helper (optional, needs AWS CLI and a key that can create buckets):
[`scripts/create-buckets.sh`](scripts/create-buckets.sh).

### 3. IAM / API keys

Create **two** Object Storage API keys (Scaleway IAM application + policy),
not one god-key and not the account root:

1. **Documents** — `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`,
   `s3:PutObjectRetention`, `s3:GetObjectRetention`, `s3:GetBucketObjectLockConfiguration`
   on `klopt-hidde-documents` only. These become `KLOPT_S3_ACCESS_KEY_ID` /
   `KLOPT_S3_SECRET_ACCESS_KEY`.
2. **Backups** — the same object verbs on `klopt-hidde-backups` only. These
   become `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`.
   WAL-G does not need `s3:BypassGovernanceRetention` in normal operation.

No Elastic Metal API key is required to run the stack; the box is
self-managed over SSH.

### 4. DNS

Hostname pattern: **`klopt.<firm-domain>`** (example: `klopt.example.com`).
`KLOPT_BASE_URL` is `https://` plus that host, nothing else (no path).

Hidde's domains stay on **Cloudflare for DNS only**. A/AAAA records must be
**DNS only / grey cloud (proxy off)**. Do **not** orange-cloud the name, do
**not** enable Cloudflare proxy, and do **not** use Cloudflare Tunnel. TLS
terminates on the Scaleway box via Caddy/ACME (HTTP-01). That is what keeps
the EU-hosted claim honest: client traffic hits Scaleway Amsterdam, not a
Cloudflare edge. Any WAF/DDoS belongs on the box or on Scaleway — not behind
a Cloudflare proxy.

| Name                  | Type     | Target                                | Cloudflare                            |
| --------------------- | -------- | ------------------------------------- | ------------------------------------- |
| `klopt.<firm-domain>` | **A**    | Elastic Metal public IPv4             | **DNS only / grey cloud (proxy off)** |
| `klopt.<firm-domain>` | **AAAA** | Elastic Metal public IPv6, if enabled | **DNS only / grey cloud (proxy off)** |

No CNAME for this hostname (a CNAME to a Cloudflare proxy target would put
edge TLS in the path). Optional CAA record allowing Let's Encrypt. Wait for
the A record before the first `migrate-then-deploy` so HTTP-01 can succeed.

Exact Online redirect, if used: `{KLOPT_BASE_URL}/exact/callback`.

## First deploy

1. Cloud-init (or Ansible: `hardening/ansible/`) has run. Log in as `klopt`
   with the SSH key. Confirm `docker` works **without** sudo:
   `docker ps`. Confirm `ufw status` allows 22/80/443 only.
2. Clone this repository to `/opt/klopt/repo` (the systemd unit assumes that
   path). `pnpm run peppol:fetch` on a machine that may download Schematron,
   and copy `reference-data/` into the clone — the compose file bind-mounts
   it.
3. `cd /opt/klopt/repo/deploy/hosted`
4. `cp env.example .env` and fill every blank. Generate:
   ```bash
   openssl rand -hex 24          # POSTGRES_PASSWORD (URL-safe)
   openssl rand -base64 32       # KLOPT_AUTH_SECRET
   openssl rand -base64 32       # KLOPT_ENCRYPTION_KEY (≥32 bytes)
   openssl rand -hex 32          # WALG_LIBSODIUM_KEY
   ```
   Set `KLOPT_SIGNUP=closed` **after** the owner account exists if you need
   the first sign-in to create the administration; then recreate web/worker.
   For an instance that already has an owner, leave it `closed` from boot.
5. `chmod +x scripts/*.sh`
6. `./scripts/migrate-then-deploy.sh`
7. `./scripts/backup-now.sh` — first base backup. Confirm objects appear in
   `klopt-hidde-backups`.
8. Sign in at `https://klopt.<firm-domain>`. Create the administration if
   this is a blank database. Then ensure `KLOPT_SIGNUP=closed` and roll web:
   `docker compose up -d --no-deps web worker`.

Ansible, if you skipped cloud-init or need to re-apply:

```bash
cp hardening/ansible/inventory.example.ini hardening/ansible/inventory.ini
# edit the host
ansible-playbook -i hardening/ansible/inventory.ini hardening/ansible/playbook.yml
```

The playbook enables `klopt-pg-backup.timer` (nightly ~02:17 Europe/Amsterdam
on the box clock — set the timezone to `Europe/Amsterdam`).

## Upgrades

Same script, same order: **migrate, then roll app containers**. Postgres is
not recreated.

```bash
cd /opt/klopt/repo
git fetch origin
git checkout <tag-or-main>
# peppol:fetch if reference-data/peppol changed
cd deploy/hosted
./scripts/migrate-then-deploy.sh
```

If a release needs a Postgres bump past 17, that is a dedicated restore onto
a new volume — not this script.

Caddy picks up the same hostname; certificates renew in the `caddy_data`
volume.

## Backup and restore drill

Continuous: `archive_command=wal-g wal-push %p` inside the Postgres
container. Nightly: `scripts/backup-now.sh` via systemd.

Encryption is client-side (`WALG_LIBSODIUM_KEY`). Scaleway sees ciphertext.

### Production restore (destroys current PGDATA)

```bash
cd /opt/klopt/repo/deploy/hosted
./scripts/restore.sh            # LATEST
# ./scripts/restore.sh <backup_name>
docker compose up -d web worker caddy
```

Do not run migrate against a restored replica unless you intend to move
schema forward from the restored revision.

### Rehearsal (does not touch production)

From this directory, with Docker:

```bash
./scripts/restore-drill.sh
```

That takes an encrypted base backup with the production WAL-G image, writes a
row after the base, restores into an empty volume, and checks WAL replay
recovered the row. The drill stores WAL-G output on a local volume (no
Scaleway credentials required). Production still targets the separate
Scaleway backups bucket. Run it on the box once after first deploy and after
any WAL-G image bump.

## Rotating secrets

| Secret                 | How                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KLOPT_AUTH_SECRET`    | New value, `docker compose up -d --no-deps web`. Every session cookie is invalid; people sign in again.                                                                                                                             |
| `KLOPT_ENCRYPTION_KEY` | **Do not rotate in place.** Adapter credentials are encrypted with it. A new key cannot read the old rows. Plan a dedicated re-encrypt if this is ever required.                                                                    |
| `POSTGRES_PASSWORD`    | Change in `.env`, `ALTER USER klopt PASSWORD '…';`, then recreate web/worker (they interpolate `DATABASE_URL`). Postgres container env is for initdb only after the volume exists.                                                  |
| `KLOPT_S3_*` keys      | Issue a new documents IAM key, put it in `.env`, roll web **and** worker together, then delete the old key.                                                                                                                         |
| Backup IAM keys        | Same, then `docker compose up -d postgres` so archive_command sees the new env. Take `backup-now.sh` immediately.                                                                                                                   |
| `WALG_LIBSODIUM_KEY`   | **Do not replace the only copy.** A new key cannot read old backups. To rotate: add a dual-key period if you introduce one; until then, keep the current key in the operator password manager and treat loss as "backups are gone". |
| SMTP password          | `.env`, roll web and worker.                                                                                                                                                                                                        |
| SSH keys               | Add the new public key to `~klopt/.ssh/authorized_keys`, confirm a new session, remove the old. cloud-init will not do this on subsequent boots.                                                                                    |
| ACME                   | Caddy stores certs in the volume; changing `ACME_EMAIL` is enough on the next reload.                                                                                                                                               |

After any `.env` edit that Postgres should see (`BACKUP_*`, `WALG_*`),
recreate **postgres** (`docker compose up -d --force-recreate postgres`).
That drops in-flight connections for a few seconds; prefer a short window.
Web/worker recreate is enough for Klopt-only variables.

## What this layout refuses

- Publishing Postgres or MinIO on the public interface.
- `KLOPT_ALLOW_PRIVATE_OUTBOUND` (audit: internet-facing instance).
- Putting real API keys in git.
- A second administration as a "tenant" on this host — one firm, one
  instance. If a second firm needs Klopt, it is another box and another
  pair of buckets.
