# syntax=docker/dockerfile:1
# storage — the headless admin CLI for storage-server, as an image.
# Build (from the repository root):
#   docker build -f packages/cli/Dockerfile -t storage-cli .
# Run with credentials from a .env file (STORAGE_URL + STORAGE_TOKEN, or
# STORAGE_SESSION from `storage auth export`):
#   docker run --rm --env-file .env storage-cli account ls
# Or log in once and keep the contexts in a volume:
#   docker run --rm -it -v storage-cli:/config storage-cli auth login '<payload>'
#   docker run --rm -v storage-cli:/config storage-cli status
# The working directory is /work: mount one there and ./.env is read from it
# and `-o` downloads land in it.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY e2e/package.json e2e/package.json
COPY apps/reference/package.json apps/reference/package.json
COPY apps/remote/package.json apps/remote/package.json
RUN npm ci --workspace packages/cli --include-workspace-root \
      --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
# The CLI bundles a few server modules (QR encoder, default paths, version).
COPY packages/server/src packages/server/src
COPY packages/cli packages/cli
RUN npm run build --workspace packages/cli
# Writable by the runtime user before VOLUME, so fresh volumes inherit it.
RUN mkdir -p /config /work && chown 65532:65532 /config /work && chmod 700 /config

# Distroless: no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/nodejs24-debian12:nonroot
LABEL org.opencontainers.image.title="storage-cli" \
      org.opencontainers.image.description="Administer a storage-server headlessly: accounts, devices, namespaces, traffic, logs, audit and troubleshooting" \
      org.opencontainers.image.source="https://github.com/niclaslindstedt/storage" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"
WORKDIR /app
COPY --from=build /src/packages/cli/dist/storage.js ./storage.js
COPY --from=build /src/packages/cli/package.json ./package.json
COPY --from=build --chown=65532:65532 /config /config
COPY --from=build --chown=65532:65532 /work /work
ENV STORAGE_CONFIG_DIR=/config \
    NODE_ENV=production
VOLUME ["/config"]
WORKDIR /work
USER nonroot
ENTRYPOINT ["/nodejs/bin/node", "/app/storage.js"]
CMD ["--help"]
