# syntax=docker/dockerfile:1
# storage-server — self-hosted, end-to-end encrypted storage.
# Build: docker build -t storage-server .
# Run:   docker run -p 8443:8443 -v storage-data:/data storage-server
# Admin console (docs/admin-console.md): with published ports add
#        -e STORAGE_ADMIN_HOST=0.0.0.0 -p 127.0.0.1:8081:8081
# (loopback on the host only); with --network host it is on 127.0.0.1:8081.

FROM node:26-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY e2e/package.json e2e/package.json
COPY apps/reference/package.json apps/reference/package.json
COPY apps/remote/package.json apps/remote/package.json
RUN npm ci --workspace packages/server --include-workspace-root \
      --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY docs docs
COPY man man
COPY packages/server packages/server
RUN npm run build --workspace packages/server
# The data directory must exist, owned by the runtime user, before VOLUME
# so a fresh (named or anonymous) volume inherits nonroot ownership.
RUN mkdir -p /data/logs && chown -R 65532:65532 /data && chmod 700 /data

# Distroless: no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/nodejs24-debian12:nonroot
LABEL org.opencontainers.image.title="storage-server" \
      org.opencontainers.image.description="Self-hosted, zero-knowledge storage for local-first apps" \
      org.opencontainers.image.source="https://github.com/niclaslindstedt/storage" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"
WORKDIR /app
COPY --from=build /src/packages/server/dist ./dist
COPY --from=build /src/packages/server/package.json ./package.json
COPY --from=build --chown=65532:65532 /data /data
ENV STORAGE_DATA_DIR=/data \
    STORAGE_LOG_FILE=/data/logs/debug.log \
    STORAGE_PORT=8443 \
    NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8443 8081
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/dist/cli.js", "health"]
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/cli.js"]
CMD ["serve"]
