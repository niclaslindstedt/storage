#!/usr/bin/env bash
# Smoke-test the CLI image against the server image: the CLI runs as a
# non-root user, reads the admin token from the server's data volume (the
# compose.yaml `cli` service), and also takes STORAGE_URL + STORAGE_TOKEN
# from an --env-file.
#
#   scripts/docker-smoke-cli.sh <server-image> <cli-image>
set -euo pipefail

server="${1:?usage: docker-smoke-cli.sh <server-image> <cli-image>}"
cli="${2:?usage: docker-smoke-cli.sh <server-image> <cli-image>}"
name="storage-cli-smoke-$$"
volume="storage-cli-smoke-$$"
envfile="$(mktemp)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$envfile"
}
trap cleanup EXIT

uid=$(docker run --rm --entrypoint /nodejs/bin/node "$cli" -e 'process.stdout.write(String(process.getuid()))')
if [ "$uid" = 0 ]; then
  echo "docker-smoke-cli: image runs as root" >&2
  exit 1
fi
docker run --rm "$cli" --version

docker run -d --name "$name" -v "$volume:/data" -p 127.0.0.1:28443:8443 \
  -e STORAGE_ADMIN_HOST=0.0.0.0 -p 127.0.0.1:28081:8081 "$server" >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$name" /nodejs/bin/node /app/dist/cli.js health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# As the compose `cli` service: the token file from the data volume.
storage() {
  docker run --rm --network host -v "$volume:/data:ro" \
    -e STORAGE_URL=http://127.0.0.1:28081 -e STORAGE_TOKEN_FILE=/data/admin.token "$cli" "$@"
}
storage account create niclas --role admin
[ "$(storage account ls -q)" = niclas ] || { echo "docker-smoke-cli: account ls" >&2; exit 1; }
storage metrics | grep -q '^storage_accounts 1$'
storage audit verify

# From an env file, as a script or CI job would.
login=$(docker exec "$name" /nodejs/bin/node /app/dist/cli.js admin)
printf 'STORAGE_URL=http://127.0.0.1:28081\nSTORAGE_TOKEN=%s\n' "${login##*token=}" >"$envfile"
docker run --rm --network host --env-file "$envfile" "$cli" auth status
echo "docker-smoke-cli: ok"
