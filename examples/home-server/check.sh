#!/usr/bin/env bash
# CI check for the home-server example: the compose file is valid, and the
# built server starts from a fresh data directory, reports healthy, and mints
# a first-admin pairing payload — the exact steps the README walks through.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cli="$root/packages/server/dist/cli.js"
[ -f "$cli" ] || { echo "check.sh: run \`make build\` first" >&2; exit 1; }

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  docker compose -f "$here/compose.yaml" config -q
  echo "compose.yaml: valid"
fi

data=$(mktemp -d)
port=18444
export STORAGE_DATA_DIR="$data" STORAGE_PORT="$port" STORAGE_ADMIN_PORT=18082
node "$cli" serve --tls self-signed --host 127.0.0.1 >"$data/serve.out" 2>&1 &
pid=$!
cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -rf "$data"; }
trap cleanup EXIT

for _ in $(seq 1 50); do
  node "$cli" health --tls self-signed >/dev/null 2>&1 && break
  sleep 0.2
done
node "$cli" health --tls self-signed
payload=$(node "$cli" setup --account you --no-qr --public-url "https://127.0.0.1:${port}")
case "$payload" in
  *oss-storage://*) echo "setup: pairing payload minted" ;;
  *) echo "check.sh: unexpected setup output: $payload" >&2; cat "$data/serve.out" >&2; exit 1 ;;
esac
