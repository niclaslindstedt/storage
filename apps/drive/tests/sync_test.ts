import { describe, expect, it } from "vitest";

import { type SyncSource, SyncMonitor } from "../src/sync.ts";

type Change = {
  kind: string;
  path: string;
  deleted: boolean;
  file?: { size: number };
};

/** A server in memory: folders with a seq and a change feed. */
function fakeSource() {
  const feeds = new Map<string, Change[]>();
  const names = new Map<string, string>();
  const listeners = new Set<(e: { type: string; ns?: string }) => void>();
  let down = false;
  const source: SyncSource = {
    async folders() {
      if (down) throw new Error("The server could not be reached.");
      return [...feeds].map(([id, feed]) => ({
        id,
        seq: feed.length,
        name: names.get(id)!,
      }));
    },
    async paths(ns) {
      const live = new Map<string, boolean>();
      for (const c of feeds.get(ns)!) live.set(c.path, !c.deleted);
      return [...live].filter(([, v]) => v).map(([p]) => p);
    },
    async changes(ns, since) {
      if (down) throw new Error("The server could not be reached.");
      const feed = feeds.get(ns)!;
      return { seq: feed.length, changes: feed.slice(since), more: false };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    source,
    folder(id: string, name: string, ...changes: Change[]) {
      feeds.set(id, changes);
      names.set(id, name);
    },
    /** A device wrote to a folder; `event` = the server tells us. */
    write(ns: string, c: Change, event = true) {
      feeds.get(ns)!.push(c);
      if (event)
        for (const l of listeners)
          l({ type: "ns", ns, seq: feeds.get(ns)!.length } as never);
    },
    set down(v: boolean) {
      down = v;
    },
    listeners,
  };
}

const put = (path: string, size = 1): Change => ({
  kind: "file",
  path,
  deleted: false,
  file: { size },
});
const del = (path: string): Change => ({ kind: "file", path, deleted: true });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("SyncMonitor", () => {
  it("starts where each folder is and reports only what happens next", async () => {
    const s = fakeSource();
    s.folder("ns1", "Documents", put("old.txt"));
    const m = new SyncMonitor(s.source, () => 1000);
    await m.start({ heartbeatMs: 0 });
    expect(m.status).toMatchObject({ state: "live", syncedAt: 1000 });
    expect(m.activity).toEqual([]);

    s.write("ns1", put("report.pdf", 42));
    s.write("ns1", put("old.txt", 3));
    s.write("ns1", put("Taxes/.folder", 0));
    s.write("ns1", del("old.txt"));
    await settle();
    await settle();
    expect(m.activity.map((a) => [a.kind, a.path, a.folder])).toEqual([
      ["deleted", "old.txt", "Documents"],
      ["folder", "Taxes", "Documents"],
      ["changed", "old.txt", "Documents"],
      ["added", "report.pdf", "Documents"],
    ]);
    expect(m.activity.at(-1)!.size).toBe(42);
    expect(m.status.state).toBe("live");
    m.stop();
    expect(s.listeners.size).toBe(0);
  });

  it("catches up on a missed event at the next check, and new folders appear", async () => {
    const s = fakeSource();
    s.folder("ns1", "Photos");
    const m = new SyncMonitor(s.source);
    await m.start({ heartbeatMs: 0 });
    s.write("ns1", put("beach.jpg"), false);
    s.folder("ns2", "Shared with me", put("a.txt"));
    await m.check();
    expect(m.activity.map((a) => a.path)).toEqual(["beach.jpg"]);
    s.write("ns2", put("b.txt"));
    await settle();
    await settle();
    expect(m.activity[0]).toMatchObject({
      path: "b.txt",
      folder: "Shared with me",
      kind: "added",
    });
    m.stop();
  });

  it("says when it is offline and recovers by itself", async () => {
    const s = fakeSource();
    s.folder("ns1", "Documents");
    const m = new SyncMonitor(s.source);
    const seen: string[] = [];
    m.onChange(() => seen.push(m.status.state));
    await m.start({ heartbeatMs: 0 });
    s.down = true;
    await m.check();
    expect(m.status).toMatchObject({
      state: "offline",
      error: "The server could not be reached.",
    });
    s.write("ns1", put("while-away.txt"), false);
    s.down = false;
    m.setOnline(true);
    await settle();
    await settle();
    expect(m.status.state).toBe("live");
    expect(m.activity[0]!.path).toBe("while-away.txt");
    expect(seen).toContain("syncing");
    m.setOnline(false);
    expect(m.status.state).toBe("offline");
    m.stop();
  });
});
