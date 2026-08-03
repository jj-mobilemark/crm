#!/bin/sh
set -eu
echo "railway-api-start: starting (PORT=${PORT:-unset})"
cd /app
bun run db:deploy
echo "railway-api-start: launching dist bundle"
exec bun /app/apps/api/dist/main.js
