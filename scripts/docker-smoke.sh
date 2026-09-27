#!/usr/bin/env bash
# Smoke-test a built image: it starts as a non-root user, the HEALTHCHECK
# command succeeds, the API answers /v1/info over its self-signed TLS, and
# the admin console, published on the host's loopback, asks for sign-in and
# accepts the token `storage-server admin` prints.
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

docker run -d --name "$name" -p 127.0.0.1:18443:8443 \
  -e STORAGE_ADMIN_HOST=0.0.0.0 -p 127.0.0.1:18081:8081 "$image" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$name" /nodejs/bin/node /app/dist/cli.js health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$name" /nodejs/bin/node /app/dist/cli.js health
curl -fsSk https://127.0.0.1:18443/v1/info
echo

login=$(docker exec "$name" /nodejs/bin/node /app/dist/cli.js admin)
token="${login##*token=}"
status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/api/overview)
[ "$status" = 401 ] || { echo "docker-smoke: console answered $status unauthenticated" >&2; exit 1; }
curl -fsS -H "Authorization: Bearer ${token}" http://127.0.0.1:18081/api/overview >/dev/null
echo "admin console: ok"
echo "docker-smoke: ok"
