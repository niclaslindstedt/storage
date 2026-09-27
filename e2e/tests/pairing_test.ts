import { describe, expect, it } from "vitest";

import {
  AuthError,
  createMemoryKeyVault,
  createSelfHostedClient,
  KeysMissingError,
  parseRecoveryKey,
} from "@niclaslindstedt/oss-framework/storage";

import { device, server, track, user } from "./helpers.ts";

describe("pairing and account keys", () => {
  it("first device: server code → needs keys → account key + recovery key → ready", async () => {
    const s = await server();
    const seeded = await s.createAccount("alice", { role: "admin" });
    const c = track(
      createSelfHostedClient({ app: "e2e", vault: createMemoryKeyVault() }),
    );
    expect(await c.pair(seeded.pairingUri, { name: "Laptop" })).toBe(
      "needs-keys",
    );
    expect(await c.accountHasKeys()).toBe(false);
    await expect(c.namespaces()).rejects.toBeInstanceOf(KeysMissingError);
    const rk = await c.createAccountKeys();
    expect(rk).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    await expect(parseRecoveryKey(rk)).resolves.toHaveLength(32);
    expect(c.state).toBe("ready");
    expect(await c.namespaces()).toEqual([]);
    await expect(c.createAccountKeys()).rejects.toThrow(/already has a key/);
  });

  it("device-to-device QR: the new device is ready at once and reads existing data", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    await ns.files.write("hello.txt", "hi from device one");
    const second = await device(alice.client);
    expect(second.state).toBe("ready");
    const [info] = await second.namespaces();
    expect(info!.meta).toEqual({ name: "Me" });
    const ns2 = await second.namespace(info!.id);
    expect((await ns2.files.readText("hello.txt"))!.text).toBe(
      "hi from device one",
    );
  });

  it("server code + approval from another device after comparing safety codes", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    await alice.client.createNamespace({ name: "Me" });
    const extra = await s.pairingFor(alice.accountId);
    const tablet = track(
      createSelfHostedClient({ app: "e2e", vault: createMemoryKeyVault() }),
    );
    expect(await tablet.pair(extra.pairingUri, { name: "Tablet" })).toBe(
      "needs-keys",
    );
    const pending = await alice.client.pendingDevices();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.safetyCode).toBe(await tablet.safetyCode());
    await alice.client.approveDevice(pending[0]!.id);
    expect(await tablet.waitForApproval({ intervalMs: 20 })).toBe("ready");
    expect(await tablet.namespaces()).toHaveLength(1);
    expect(await alice.client.pendingDevices()).toEqual([]);
  });

  it("recovery key restores access on a brand-new device; a wrong one is refused", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    await ns.records<{ n: number }>("counters").put("a", { n: 1 });
    const other = await user(s, "mallory");
    const extra = await s.pairingFor(alice.accountId);
    const fresh = track(
      createSelfHostedClient({ app: "e2e", vault: createMemoryKeyVault() }),
    );
    await fresh.pair(extra.pairingUri, { name: "New phone" });
    await expect(fresh.recover(other.recoveryKey!)).rejects.toThrow(
      /does not belong/,
    );
    await expect(fresh.recover("AAAA-BBBB")).rejects.toThrow(/recovery key/);
    await fresh.recover(alice.recoveryKey!);
    expect(fresh.state).toBe("ready");
    const ns2 = await fresh.namespace(ns.id);
    expect(
      (await ns2.records<{ n: number }>("counters").get("a"))!.value,
    ).toEqual({ n: 1 });
    // regenerate: the old recovery key stops working
    const newRk = await fresh.regenerateRecoveryKey();
    const extra2 = await s.pairingFor(alice.accountId);
    const again = track(
      createSelfHostedClient({ app: "e2e", vault: createMemoryKeyVault() }),
    );
    await again.pair(extra2.pairingUri, { name: "Another" });
    await expect(again.recover(alice.recoveryKey!)).rejects.toThrow(
      /does not belong/,
    );
    await again.recover(newRk);
    expect(again.state).toBe("ready");
  });

  it("restores a session from the vault (a reload) and signs in again silently", async () => {
    const s = await server();
    const seeded = await s.createAccount("alice");
    const vault = createMemoryKeyVault();
    const a = track(createSelfHostedClient({ app: "e2e", vault }));
    await a.pair(seeded.pairingUri, { name: "Browser" });
    await a.createAccountKeys();
    const ns = await a.createNamespace({ name: "Me" });
    await s.clock.advance(20 * 60_000); // the old token is long expired
    const reloaded = track(createSelfHostedClient({ app: "e2e", vault }));
    expect(await reloaded.restore()).toBe("ready");
    expect((await reloaded.namespace(ns.id)).meta.name).toBe("Me");
  });

  it("works with a bytes-only (native keystore) vault", async () => {
    const s = await server();
    const seeded = await s.createAccount("alice");
    const vault = createMemoryKeyVault("bytes");
    const a = track(createSelfHostedClient({ app: "e2e", vault }));
    await a.pair(seeded.pairingUri, { name: "iPhone", platform: "ios" });
    await a.createAccountKeys();
    const ns = await a.createNamespace({ name: "Me" });
    await ns.files.write("x", "native");
    const reloaded = track(createSelfHostedClient({ app: "e2e", vault }));
    expect(await reloaded.restore()).toBe("ready");
    expect(
      (await (await reloaded.namespace(ns.id)).files.readText("x"))!.text,
    ).toBe("native");
  });

  it("a revoked device loses access immediately", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const phone = await device(alice.client);
    const devices = await alice.client.devices();
    const phoneId = phone.session!.deviceId;
    expect(devices.map((d) => d.id)).toContain(phoneId);
    await alice.client.revokeDevice(phoneId);
    await expect(phone.namespaces()).rejects.toBeInstanceOf(AuthError);
  });
});
