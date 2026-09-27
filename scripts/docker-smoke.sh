#!/usr/bin/env bash
# Smoke-test a built image: it starts as a non-root user, the HEALTHCHECK
# command succeeds, and the API answers /v1/info over its self-signed TLS.
#
#   scripts/docker-smoke.sh <image>
set -euo pipefail

image="${1:?usage: docker-smoke.sh <image>}"
name="storage-smoke-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

uid=$(docker run --rm --entrypoint /nodejs/bin/node "$image" -e 'process.stdout.write(String(process.getuid()))')
if [ "$uid" = 0 ]; then
  echo "docker-smoke: image runs as root" >&2
  exit 1
fi

docker run -d --name "$name" -p 127.0.0.1:18443:8443 "$image" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$name" /nodejs/bin/node /app/dist/cli.js health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$name" /nodejs/bin/node /app/dist/cli.js health
curl -fsSk https://127.0.0.1:18443/v1/info
echo
echo "docker-smoke: ok"
