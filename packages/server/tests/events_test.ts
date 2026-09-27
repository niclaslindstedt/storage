import { describe, expect, it } from "vitest";

import { EventHub, type HubEvent } from "../src/events.ts";

describe("EventHub", () => {
  it("delivers namespace events only to member accounts", () => {
    const hub = new EventHub();
    const a: HubEvent[] = [];
    const b: HubEvent[] = [];
    hub.subscribe("acc_a", "dev_a", (e) => a.push(e));
    hub.subscribe("acc_b", "dev_b", (e) => b.push(e));
    hub.publishNs("ns_1", 3, ["acc_a"]);
    expect(a).toEqual([{ type: "ns", ns: "ns_1", seq: 3 }]);
    expect(b).toEqual([]);
  });

  it("wakes long-pollers when a namespace passes their seq", async () => {
    const hub = new EventHub();
    const woke = hub.waitForNs("ns_1", 5, 5_000);
    hub.publishNs("ns_1", 5, []);
    hub.publishNs("ns_1", 6, []);
    expect(await woke).toBe(true);
    expect(await hub.waitForNs("ns_1", 6, 10)).toBe(false);
  });

  it("closes a revoked device's streams", () => {
    const hub = new EventHub();
    const got: HubEvent[] = [];
    let closed = false;
    hub.subscribe(
      "acc_a",
      "dev_a",
      (e) => got.push(e),
      () => (closed = true),
    );
    hub.revokeDevice("dev_a");
    expect(got).toEqual([{ type: "device", deviceId: "dev_a", revoked: true }]);
    expect(closed).toBe(true);
    expect(hub.subscriberCount).toBe(0);
  });
});
