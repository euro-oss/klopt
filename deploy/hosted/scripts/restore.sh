#!/usr/bin/env bash
# Restore Postgres from WAL-G into the *current* data volume.
#
# This replaces the running database. Web and worker are stopped first.
# For a non-destructive rehearsal use restore-drill.sh.
#
# Usage:
#   ./scripts/restore.sh              # latest base backup + WAL
#   ./scripts/restore.sh base_00000…  # named backup
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKUP_NAME="${1:-LATEST}"

if [[ ! -f .env ]]; then
  echo "deploy/hosted/.env is missing." >&2
  exit 1
fi

echo "About to stop web/worker, wipe PGDATA, and restore ${BACKUP_NAME}."
echo "Ctrl-C now if that is not what you meant."
sleep 5

docker compose stop web worker
docker compose stop postgres

# A one-shot container on the same volume, same env, same image.
docker compose run -iT --rm --no-deps --user postgres --entrypoint bash postgres <<EOF
set -euo pipefail
# Empty the data directory without deleting the volume mount itself.
find /var/lib/postgresql/data -mindepth 1 -delete
wal-g backup-fetch /var/lib/postgresql/data ${BACKUP_NAME}
touch /var/lib/postgresql/data/recovery.signal
echo "fetched ${BACKUP_NAME}; recovery.signal in place"
EOF

docker compose up -d postgres
echo "waiting for postgres after recovery"
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U klopt -d klopt >/dev/null 2>&1; then
    docker compose exec -T postgres psql -U klopt -d klopt -c 'SELECT now();'
    echo "restore complete. start web/worker with scripts/migrate-then-deploy.sh (skip migrate if the restored schema is already current) or: docker compose up -d web worker caddy"
    exit 0
  fi
  sleep 2
done

echo "postgres did not become ready after restore" >&2
docker compose logs postgres | tail -n 80 >&2
exit 1
