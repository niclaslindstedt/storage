import { describe, expect, it } from "vitest";

import { device, server, user, waitFor } from "./helpers.ts";

describe("live updates", () => {
  it("a write on one device reaches another over the event stream", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Live" });
    const phone = await device(alice.client);
    const nsPhone = await phone.namespace(ns.id);
    const seqs: number[] = [];
    const stop = nsPhone.watch((seq) => seqs.push(seq));
    await new Promise((r) => setTimeout(r, 150));
    await ns.records("c").put("k", 1);
    await waitFor(() => seqs.length > 0);
    stop();
  });

  it("a live RecordStore pulls remote edits and pushes local ones by itself", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Live" });
    const phone = await device(alice.client);
    const a = ns.recordStore<string>("todo");
    const b = (await phone.namespace(ns.id)).recordStore<string>("todo");
    const stopA = a.live({ debounceMs: 20 });
    const stopB = b.live({ debounceMs: 20 });
    await new Promise((r) => setTimeout(r, 150));
    a.set("1", "buy milk");
    await waitFor(() => b.get("1") === "buy milk");
    b.set("2", "call mum");
    await waitFor(() => a.get("2") === "call mum");
    stopA();
    stopB();
  });

  it("the change feed long-polls", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Poll" });
    const since = ns.info.seq;
    const pending = ns.changes(since, { waitSeconds: 5 });
    setTimeout(() => void ns.records("c").put("k", { hello: "world" }), 50);
    const feed = await pending;
    expect(feed.changes).toEqual([
      expect.objectContaining({
        kind: "record",
        collection: "c",
        key: "k",
        value: { hello: "world" },
      }),
    ]);
  });
});
