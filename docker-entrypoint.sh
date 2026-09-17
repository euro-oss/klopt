#!/bin/sh
# Two words the image understands, and everything else is a `klopt` command.
#
#   docker run klopt migrate   → bring the schema up to date, then exit
#   docker run klopt serve     → the API and the worker (the default)
#   docker run klopt check --year 2025
#
# `exec` in every branch, so the process the container waits on is the one
# doing the work and SIGTERM reaches it directly rather than through a shell
# that would swallow it.
set -e

case "$1" in
  migrate)
    exec node /app/packages/db/dist/bin/migrate.js
    ;;
  '')
    exec node /app/apps/cli/dist/main.js serve
    ;;
  *)
    exec node /app/apps/cli/dist/main.js "$@"
    ;;
esac
