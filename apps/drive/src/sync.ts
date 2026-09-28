// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Watching files sync. The server says only *that* a shared folder moved
// (`/v1/events`: `ns` with its new seq, SPEC §6.6); this pulls each moved
// folder's change feed from where it left off, decrypts it here, and turns
// it into activity — "report.pdf was added in Documents" — plus a status:
// connecting, up to date, syncing, or offline. A heartbeat re-checks every
// folder's seq, so a missed event or a dropped connection heals itself.
// The client is behind a small seam (`SyncSource`) so tests drive it.

import type {
  SelfHostedClient,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { DRIVE_APP } from "@storage/remote/client.ts";
import { FOLDER_MARKER } from "@storage/remote/files/tree.ts";

export type SyncState = "connecting" | "live" | "syncing" | "offline";

export type Activity = {
  /** When this device learnt of it. */
  at: number;
  ns: string;
  /** The shared folder's name. */
  folder: string;
  path: string;
  kind: "added" | "changed" | "deleted" | "folder";
  size?: number;
};

export type SyncStatus = {
  state: SyncState;
  /** The last time every folder was known to be up to date. */
  syncedAt: number | null;
  error: string | null;
  /** The server refused this device (revoked, or its account disabled). */
  lostAccess: boolean;
};

type FileChange = {
  kind: "file";
  path: string;
  deleted: boolean;
  file?: { size: number };
};

/** What the monitor needs from the client. */
export type SyncSource = {
  folders(): Promise<{ id: string; seq: number; name: string }[]>;
  /** Paths that exist now (to tell a new file from a changed one). */
  paths(ns: string): Promise<string[]>;
  changes(
    ns: string,
    since: number,
  ): Promise<{
    seq: number;
    changes: ({ kind: string } | FileChange)[];
    more: boolean;
  }>;
  /** Server events; returns an unsubscribe function. */
  subscribe(
    listener: (e: { type: string; ns?: string; seq?: number }) => void,
  ): () => void;
};

export function clientSource(client: SelfHostedClient): SyncSource {
  const open = new Map<string, Promise<StorageNamespace>>();
  const ns = (id: string) => {
    let p = open.get(id);
    if (!p) {
      p = client.namespace(id);
      p.catch(() => open.delete(id));
      open.set(id, p);
    }
    return p;
  };
  return {
    async folders() {
      return (await client.namespaces(DRIVE_APP)).map((f) => ({
        id: f.id,
        seq: f.seq,
        name: String(f.meta.name ?? f.id),
      }));
    },
    async paths(id) {
      return (await (await ns(id)).files.list()).map((f) => f.path);
    },
    async changes(id, since) {
      return (await ns(id)).changes(since, { limit: 500 });
    },
    subscribe: (listener) => client.subscribe(listener),
  };
}

const HEARTBEAT_MS = 30_000;
const KEEP = 200;

export class SyncMonitor {
  private readonly cursors = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly known = new Map<string, Set<string>>();
  private readonly pulling = new Map<string, Promise<boolean>>();
  private readonly again = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private unsubscribe: () => void = () => {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  readonly activity: Activity[] = [];
  status: SyncStatus = {
    state: "connecting",
    syncedAt: null,
    error: null,
    lostAccess: false,
  };

  constructor(
    private readonly source: SyncSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Start listening; resolves once every folder's position is known. */
  async start(opts: { heartbeatMs?: number } = {}): Promise<void> {
    this.unsubscribe = this.source.subscribe((e) => {
      if (e.type === "ns" && e.ns && this.cursors.has(e.ns))
        void this.pull(e.ns);
      else if (e.type === "namespaces") void this.check();
    });
    const beat = opts.heartbeatMs ?? HEARTBEAT_MS;
    if (beat > 0) this.timer = setInterval(() => void this.check(), beat);
    await this.check();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    clearInterval(this.timer);
    this.listeners.clear();
  }

  /** Called on every status or activity change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The browser went offline or came back. */
  setOnline(online: boolean): void {
    if (online) void this.check();
    else this.set({ state: "offline", error: "This device is offline." });
  }

  /** Compare every folder's seq with ours; pull what moved. */
  async check(): Promise<void> {
    if (this.stopped) return;
    let folders;
    try {
      folders = await this.source.folders();
    } catch (err) {
      this.failed(err);
      return;
    }
    const pulls: Promise<boolean>[] = [];
    for (const f of folders) {
      this.names.set(f.id, f.name);
      const at = this.cursors.get(f.id);
      if (at === undefined) {
        // A folder we have not watched yet: start from where it is now.
        this.cursors.set(f.id, f.seq);
        void this.source
          .paths(f.id)
          .then((p) => this.known.set(f.id, new Set(p)))
          .catch(() => {});
      } else if (f.seq > at) pulls.push(this.pull(f.id));
    }
    for (const id of [...this.cursors.keys()])
      if (!folders.some((f) => f.id === id)) this.cursors.delete(id);
    const ok = (await Promise.all(pulls)).every(Boolean);
    // Up to date — unless a pull failed, or an event's pull is still going
    // (it says so itself when it is done).
    if (ok && this.pulling.size === 0)
      this.set({ state: "live", syncedAt: this.now(), error: null });
  }

  /** Fetch one folder's changes since our cursor (one pull at a time). */
  private pull(ns: string): Promise<boolean> {
    const running = this.pulling.get(ns);
    if (running) {
      this.again.add(ns);
      return running;
    }
    const p = this.drain(ns).finally(() => {
      this.pulling.delete(ns);
      if (this.again.delete(ns)) void this.pull(ns);
      else if (this.pulling.size === 0 && this.status.state === "syncing")
        this.set({ state: "live", syncedAt: this.now(), error: null });
    });
    this.pulling.set(ns, p);
    return p;
  }

  private async drain(ns: string): Promise<boolean> {
    this.set({ state: "syncing" });
    try {
      for (;;) {
        const since = this.cursors.get(ns);
        if (since === undefined) return true;
        const page = await this.source.changes(ns, since);
        this.cursors.set(ns, page.seq);
        for (const c of page.changes) this.note(ns, c);
        if (!page.more) return true;
      }
    } catch (err) {
      // Our position is older than what the server still keeps: pick the
      // folder up again from where it is now, at the next check.
      if ((err as Error).name === "CursorExpiredError") {
        this.cursors.delete(ns);
        setTimeout(() => void this.check(), 0);
        return true;
      }
      this.failed(err);
      return false;
    }
  }

  private note(ns: string, c: { kind: string } | FileChange): void {
    if (c.kind !== "file") return;
    const f = c as FileChange;
    const known = this.known.get(ns);
    const marker =
      f.path === FOLDER_MARKER || f.path.endsWith(`/${FOLDER_MARKER}`);
    const path = marker ? f.path.slice(0, -FOLDER_MARKER.length - 1) : f.path;
    let kind: Activity["kind"];
    if (marker) {
      if (f.deleted) return; // a folder's files report their own deletion
      kind = "folder";
    } else if (f.deleted) kind = "deleted";
    else kind = known && !known.has(f.path) ? "added" : "changed";
    if (known) {
      if (f.deleted) known.delete(f.path);
      else known.add(f.path);
    }
    this.activity.unshift({
      at: this.now(),
      ns,
      folder: this.names.get(ns) ?? ns,
      path,
      kind,
      ...(f.file && !f.deleted ? { size: f.file.size } : {}),
    });
    this.activity.splice(KEEP);
    this.emit();
  }

  private failed(err: unknown): void {
    this.set({
      state: "offline",
      error: (err as Error).message,
      lostAccess: (err as Error).name === "AuthError",
    });
  }

  private set(s: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...s };
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
