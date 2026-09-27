// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Server configuration: every tunable in one typed object with secure
// defaults. The CLI layers flags > env (`STORAGE_*`) > `config.json` in the
// data dir > these defaults (see `cli/config-load.ts`).

export type TlsMode = "acme" | "files" | "self-signed" | "off";

export type ServerConfig = {
  /** Display name shown in pairing QR codes and `/v1/info`. */
  name: string;
  /** Where the database, blobs, certificates and logs live. `null` = memory. */
  dataDir: string | null;
  /** The externally reachable base URL devices use (goes into QR payloads). */
  publicUrl: string | null;
  /** Optional app link template: QR codes become `<appUrl>#oss=<payload>`. */
  appUrl: string | null;
  listen: {
    host: string;
    port: number;
    /** Plain-HTTP port for ACME http-01 and redirects; `null` disables. */
    httpPort: number | null;
    /** Loopback-only admin page port; `null` disables. */
    adminPort: number | null;
  };
  tls: {
    mode: TlsMode;
    /** ACME / certificate identifiers: DNS names or IP addresses. */
    domains: string[];
    acmeDirectory: string;
    acmeEmail: string | null;
    /** Request the short-lived profile (required for IP certificates). */
    acmeProfile: string | null;
    certFile: string | null;
    keyFile: string | null;
  };
  upnp: { enabled: boolean; leaseSeconds: number };
  /** Trust `X-Forwarded-For` from a reverse proxy. */
  trustProxy: boolean;
  cors: {
    /** `paired`: origins learnt at pairing + `origins`; `any`: every origin. */
    mode: "paired" | "any";
    origins: string[];
  };
  limits: {
    maxBodyBytes: number;
    maxFileBytes: number;
    maxPartBytes: number;
    maxRecordBytes: number;
    maxMetaBytes: number;
    maxBatchOps: number;
    maxFeedBytes: number;
  };
  ttl: {
    tokenSeconds: number;
    challengeSeconds: number;
    pairingSeconds: number;
    inviteSeconds: number;
    uploadSeconds: number;
  };
  retention: {
    historyCount: number;
    historyDays: number;
    trashDays: number;
    tombstoneDays: number;
  };
  rateLimit: {
    /** Unauthenticated requests (pair, auth, invite accept) per IP per minute. */
    publicPerMinute: number;
    /** Authenticated requests per device per minute. */
    devicePerMinute: number;
  };
  /** Quota for new accounts, bytes; `null` = unlimited. */
  defaultQuotaBytes: number | null;
  /** Enables `/__test/*`. Never enable on a server holding real data. */
  testMode: boolean;
  testSecret: string | null;
};

const MiB = 1024 * 1024;

export const DEFAULT_CONFIG: ServerConfig = {
  name: "storage",
  dataDir: null,
  publicUrl: null,
  appUrl: null,
  listen: { host: "0.0.0.0", port: 8443, httpPort: null, adminPort: 8081 },
  tls: {
    mode: "self-signed",
    domains: [],
    acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory",
    acmeEmail: null,
    acmeProfile: null,
    certFile: null,
    keyFile: null,
  },
  upnp: { enabled: false, leaseSeconds: 3600 },
  trustProxy: false,
  cors: { mode: "paired", origins: [] },
  limits: {
    maxBodyBytes: 32 * MiB,
    maxFileBytes: 4096 * MiB,
    maxPartBytes: 16 * MiB,
    maxRecordBytes: 1 * MiB,
    maxMetaBytes: 16 * 1024,
    maxBatchOps: 500,
    maxFeedBytes: 4 * MiB,
  },
  ttl: {
    tokenSeconds: 600,
    challengeSeconds: 60,
    pairingSeconds: 600,
    inviteSeconds: 7 * 24 * 3600,
    uploadSeconds: 24 * 3600,
  },
  retention: { historyCount: 20, historyDays: 30, trashDays: 30, tombstoneDays: 90 },
  rateLimit: { publicPerMinute: 30, devicePerMinute: 1200 },
  defaultQuotaBytes: null,
  testMode: false,
  testSecret: null,
};

export type ConfigOverrides = {
  [K in keyof ServerConfig]?: ServerConfig[K] extends Record<string, unknown>
    ? Partial<ServerConfig[K]>
    : ServerConfig[K];
};

/** Deep-merge overrides (one level of nesting) onto the defaults. */
export function resolveConfig(
  ...layers: (ConfigOverrides | undefined)[]
): ServerConfig {
  const out = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const base = out[key];
      if (
        base &&
        typeof base === "object" &&
        !Array.isArray(base) &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        out[key] = { ...(base as object), ...stripUndefined(value as object) };
      } else {
        out[key] = value;
      }
    }
  }
  return out as ServerConfig;
}

function stripUndefined(obj: object): object {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}
