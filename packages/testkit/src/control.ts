// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The test controls, spoken over HTTP to `/__test/*` — identical whether the
// server runs in this process or as a child process (Playwright).

import type { FaultRule, Snapshot } from "@niclaslindstedt/storage-server";

export type AccountRole = "admin" | "member" | "guest";

export type SeededAccount = {
  account: { id: string; name: string; role: AccountRole };
  /** A one-time code: `oss-storage://pair?...` for the account's first device. */
  pairingUri: string;
  pairingCode: string;
  expiresAt: number;
};

export type FaultOptions = {
  /** Only requests whose path starts with this. */
  path?: string;
  method?: string;
  /** How many requests the fault hits; forever when omitted. */
  times?: number;
};

export type TestServer = {
  /** Base URL of the API (plain HTTP on 127.0.0.1). */
  readonly url: string;
  /** The `X-Test-Secret` the controls need. */
  readonly secret: string;
  createAccount(
    name: string,
    options?: { role?: AccountRole; quotaBytes?: number | null },
  ): Promise<SeededAccount>;
  /**
   * Another pairing code for an existing account. `console: true` pairs an
   * admin device (admin accounts only), which may use `/v1/console`.
   */
  pairingFor(
    accountId: string,
    options?: { console?: boolean },
  ): Promise<Omit<SeededAccount, "account">>;
  faults: {
    add(...rules: FaultRule[]): Promise<void>;
    /** Drop connections (the network is gone). */
    offline(options?: FaultOptions): Promise<void>;
    /** Answer with an HTTP status (e.g. 503, or 429 with `retryAfter` seconds). */
    status(
      status: number,
      options?: FaultOptions & { retryAfter?: number },
    ): Promise<void>;
    /** Delay requests by `ms`. */
    delay(ms: number, options?: FaultOptions): Promise<void>;
    clear(): Promise<void>;
  };
  clock: {
    advance(ms: number): Promise<number>;
    set(epochMs: number): Promise<number>;
    reset(): Promise<number>;
  };
  snapshot(): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<void>;
  /** Back to an empty server (keeps its id). */
  reset(): Promise<void>;
  /** Run retention / housekeeping now. */
  retention(): Promise<unknown>;
  close(): Promise<void>;
};

export function controlClient(
  url: string,
  secret: string,
  close: () => Promise<void>,
): TestServer {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(url + path, {
      method,
      headers: {
        "X-Test-Secret": secret,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `${method} ${path}: HTTP ${res.status} ${await res.text()}`,
      );
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  const rule = (
    action: FaultRule["action"],
    o: FaultOptions = {},
    extra: Partial<FaultRule> = {},
  ): FaultRule => ({
    match: {
      ...(o.path ? { path: o.path } : {}),
      ...(o.method ? { method: o.method } : {}),
    },
    action,
    ...(o.times !== undefined ? { times: o.times } : {}),
    ...extra,
  });
  return {
    url,
    secret,
    createAccount: (name, options = {}) =>
      call("POST", "/__test/accounts", {
        name,
        role: options.role ?? "member",
        quotaBytes: options.quotaBytes,
      }),
    pairingFor: (accountId, options = {}) =>
      call(
        "POST",
        `/__test/accounts/${encodeURIComponent(accountId)}/pairings`,
        { console: options.console === true },
      ),
    faults: {
      add: async (...rules) =>
        void (await call("POST", "/__test/faults", { rules })),
      offline: async (o) =>
        void (await call("POST", "/__test/faults", {
          rules: [rule("offline", o)],
        })),
      status: async (status, o = {}) =>
        void (await call("POST", "/__test/faults", {
          rules: [
            rule("status", o, {
              status,
              ...(o.retryAfter !== undefined
                ? { retryAfter: o.retryAfter }
                : {}),
            }),
          ],
        })),
      delay: async (ms, o) =>
        void (await call("POST", "/__test/faults", {
          rules: [rule("delay", o, { delayMs: ms })],
        })),
      clear: async () => void (await call("DELETE", "/__test/faults")),
    },
    clock: {
      advance: async (ms) =>
        (
          await call<{ now: number }>("POST", "/__test/clock", {
            advanceMs: ms,
          })
        ).now,
      set: async (ms) =>
        (await call<{ now: number }>("POST", "/__test/clock", { set: ms })).now,
      reset: async () =>
        (await call<{ now: number }>("POST", "/__test/clock", { reset: true }))
          .now,
    },
    snapshot: () => call("GET", "/__test/snapshot"),
    restore: async (s) => void (await call("POST", "/__test/restore", s)),
    reset: async () => void (await call("POST", "/__test/reset")),
    retention: () => call("POST", "/__test/retention"),
    close,
  };
}
