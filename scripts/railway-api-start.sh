#!/bin/sh
set -eu
cd /app
bun run db:deploy
cd apps/api
exec bun src/main.ts
