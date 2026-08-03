#!/bin/sh
set -eu

# Run eve under Node (not Bun, not npx/npm). just-bash needs Node's Module
# hooks; npm rejects this monorepo's packageManager=bun constraint.
cd /app/apps/agent

EVE_BIN="$(node -p "require('path').join(require('path').dirname(require.resolve('eve/package.json')), 'bin', 'eve.js')")"
PORT="${PORT:-2000}"

echo "railway-agent-start: node=$(node -v) port=${PORT} eve=${EVE_BIN}"
exec node "${EVE_BIN}" start --host 0.0.0.0 --port "${PORT}"
