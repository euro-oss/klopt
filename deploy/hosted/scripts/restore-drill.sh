#!/usr/bin/env bash
# Non-destructive WAL-G restore rehearsal (file storage, isolated volumes).
# Does not touch a production volume. Requires Docker.
#
# Proves: archive_command, encrypted backup-push, backup-fetch, WAL replay.
# Production still uses Scaleway Object Storage via WALG_S3_PREFIX.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="klopt-walg-drill"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.drill.yml)

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ">> drill stack"
"${COMPOSE[@]}" up -d --build postgres

echo ">> wait for postgres"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U klopt -d klopt >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" exec -T postgres pg_isready -U klopt -d klopt

echo ">> seed"
"${COMPOSE[@]}" exec -T postgres psql -U klopt -d klopt -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS drill (id int PRIMARY KEY, note text);
   INSERT INTO drill VALUES (1, 'before-base') ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note;"

echo ">> base backup"
"${COMPOSE[@]}" exec -T -u postgres postgres wal-g backup-push /var/lib/postgresql/data
"${COMPOSE[@]}" exec -T -u postgres postgres wal-g backup-list

echo ">> WAL after the base"
"${COMPOSE[@]}" exec -T postgres psql -U klopt -d klopt -v ON_ERROR_STOP=1 -c \
  "UPDATE drill SET note = 'after-base-must-replay' WHERE id = 1;
   SELECT pg_switch_wal();"

# Give archive_command a moment.
sleep 5

echo ">> restore into a fresh volume"
"${COMPOSE[@]}" stop postgres
"${COMPOSE[@]}" run -iT --rm --no-deps --user postgres --entrypoint bash postgres <<'EOF'
set -euo pipefail
find /var/lib/postgresql/data -mindepth 1 -delete
wal-g backup-fetch /var/lib/postgresql/data LATEST
touch /var/lib/postgresql/data/recovery.signal
EOF

"${COMPOSE[@]}" up -d postgres
echo ">> wait for recovery"
NOTE=""
for _ in $(seq 1 60); do
  if NOTE="$("${COMPOSE[@]}" exec -T postgres psql -U klopt -d klopt -Atc "SELECT note FROM drill WHERE id = 1;" 2>/dev/null || true)"; then
    if [[ "$NOTE" == "after-base-must-replay" ]]; then
      echo "restore drill passed: WAL replay restored '${NOTE}'"
      exit 0
    fi
  fi
  sleep 2
done

echo "restore drill failed. last note='${NOTE}'" >&2
"${COMPOSE[@]}" logs postgres | tail -n 100 >&2
exit 1
