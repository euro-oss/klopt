#!/usr/bin/env bash
# Encrypted base backup of PGDATA to the backups bucket (WAL-G). WAL is already
# pushed continuously by archive_command.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker compose exec -T -u postgres postgres wal-g backup-push /var/lib/postgresql/data
docker compose exec -T -u postgres postgres wal-g backup-list
echo "base backup finished."
