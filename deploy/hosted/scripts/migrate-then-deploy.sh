#!/usr/bin/env bash
# Build (if needed), migrate, then roll web and worker. Postgres and Caddy stay
# up. The image does not migrate on boot — this script is what does.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "deploy/hosted/.env is missing. Copy env.example and fill it in." >&2
  exit 1
fi

docker compose build postgres web

echo ">> postgres up (not recreated)"
docker compose up -d postgres
docker compose exec -T postgres pg_isready -U klopt -d klopt

echo ">> migrate"
docker compose run --rm --no-deps --entrypoint docker-entrypoint.sh web migrate

echo ">> roll web and worker"
docker compose up -d --no-deps --build web worker

echo ">> caddy"
docker compose up -d caddy

docker compose ps
echo "migrate-then-deploy finished."
