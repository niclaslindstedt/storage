// Response shapes of the console API (src/admin/api.ts). The UI is compiled
// separately from the server, so these mirror the server types; the console
// and browser tests catch any drift.

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
};

export type LogEntry = {
  seq: number;
  at: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
};

export type AuditEntry = {
  id: number;
  at: number;
  actor: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  detail: unknown;
};

export type MinuteBucket = {
  at: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  p50: number;
  p95: number;
};

export type PortMapStatus = {
  method: "upnp" | "natpmp" | null;
  externalIp: string | null;
  mapped: { internal: number; external: number }[];
  warning: string | null;
  error: string | null;
};

export type Overview = {
  server: {
    name: string;
    version: string;
    serverId: string;
    startedAt: number;
    uptimeSeconds: number;
    node: string;
    platform: string;
    pid: number;
    memory: { rss: number; heapUsed: number };
    load: number[];
  };
  urls: { public: string; publicConfigured: boolean };
  tls: {
    mode: string;
    fp: string | null;
    notAfter: string | null;
    daysLeft: number | null;
    names: string | null;
  };
  portMapping: PortMapStatus | null;
  storage: {
    dataDir: string | null;
    databaseBytes: number;
    blobBytes: number;
    blobCount: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
  };
  counts: {
    accounts: number;
    admins: number;
    disabledAccounts: number;
    devices: number;
    pendingDevices: number;
    revokedDevices: number;
    namespaces: number;
    files: number;
    records: number;
    pendingInvites: number;
    activePairings: number;
  };
  traffic: {
    totals: {
      requests: number;
      clientErrors: number;
      serverErrors: number;
      rateLimited: number;
      since: number;
    };
    latency: { p50: number; p95: number; p99: number };
    sseConnections: number;
    series: MinuteBucket[];
  };
  logs: { warn: number; error: number };
  audit: { ok: boolean; entries: number; head: string };
  health: {
    status: "ok" | "warn" | "fail";
    checkedAt: number;
    problems: CheckResult[];
  };
  recent: { problems: LogEntry[]; audit: AuditEntry[] };
};

export type Account = {
  id: string;
  name: string;
  role: "admin" | "member" | "guest";
  quotaBytes: number | null;
  usedBytes: number;
  createdAt: number;
  disabled: boolean;
  hasKeys: boolean;
  devices: number;
  namespaces: number;
  lastSeenAt: number | null;
};

export type Device = {
  id: string;
  name: string;
  platform: string;
  accountId: string;
  account: string;
  origin: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  state: "active" | "pending" | "revoked";
  /** An admin device: may use this console remotely (SPEC §11.2). */
  console: boolean;
};

export type Namespace = {
  id: string;
  app: string;
  owner: string;
  members: { name: string; role: string }[];
  usedBytes: number;
  seq: number;
  epoch: number;
  createdAt: number;
  pendingInvites: number;
};

export type Pairing = { payload: string; svg: string; expiresAt: number };

export type RouteStats = {
  method: string;
  route: string;
  count: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
};

export type Metrics = {
  series: MinuteBucket[];
  routes: RouteStats[];
  totals: Overview["traffic"]["totals"];
  latency: Overview["traffic"]["latency"];
  sseConnections: number;
};
