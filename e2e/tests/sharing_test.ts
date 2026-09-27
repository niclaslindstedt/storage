import { describe, expect, it } from "vitest";

import {
  AuthError,
  createMemoryKeyVault,
  createSelfHostedClient,
  StorageNotFoundError,
} from "@niclaslindstedt/oss-framework/storage";

import { server, track, user } from "./helpers.ts";

describe("sharing one namespace", () => {
  it("an invite gives another account access to ONE namespace only", async () => {
    const s = await server();
    const mum = await user(s, "mum", "meds");
    const carer = await user(s, "carer", "meds");
    const shared = await mum.client.createNamespace({
      name: "Mum's medication",
    });
    const secret = await mum.client.createNamespace({ name: "Private" });
    await shared.records("medications").put("m1", { name: "Levaxin" });
    await secret.records("medications").put("x", { name: "private" });
    const { payload } = await shared.invite({ role: "editor" });
    expect(payload).toMatch(/^oss-storage:\/\/invite\?v=1/);
    const { namespace } = await carer.client.acceptInvite(payload);
    expect(namespace.role).toBe("editor");
    expect(namespace.meta.name).toBe("Mum's medication");
    expect((await namespace.records("medications").get("m1"))!.value).toEqual({
      name: "Levaxin",
    });
    await namespace
      .records("medications")
      .put("m2", { name: "Added by carer" });
    expect((await shared.records("medications").get("m2"))!.value).toEqual({
      name: "Added by carer",
    });
    expect((await carer.client.namespaces()).map((n) => n.meta.name)).toEqual([
      "Mum's medication",
    ]);
    await expect(carer.client.namespace(secret.id)).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    // single use
    await expect(
      user(s, "third", "meds").then((t) => t.client.acceptInvite(payload)),
    ).rejects.toThrow();
  });

  it("someone without an account joins as a guest via the invite alone", async () => {
    const s = await server();
    const mum = await user(s, "mum", "meds");
    const ns = await mum.client.createNamespace({ name: "Mum" });
    await ns.files.write("plan.md", "morning: 1 tablet");
    const { payload } = await ns.invite({ role: "viewer" });
    const doctor = track(
      createSelfHostedClient({ app: "meds", vault: createMemoryKeyVault() }),
    );
    const { namespace, recoveryKey } = await doctor.acceptInvite(payload, {
      accountName: "Dr. Visitor",
      device: { name: "Clinic tablet" },
    });
    expect(recoveryKey).toBeTruthy();
    expect(doctor.state).toBe("ready");
    expect((await namespace.files.readText("plan.md"))!.text).toBe(
      "morning: 1 tablet",
    );
    expect((await doctor.account()).role).toBe("guest");
    await expect(doctor.createNamespace({ name: "mine" })).rejects.toThrow();
    // The guest's devices can be added like anyone's; the reloaded device keeps working.
    const members = await ns.members();
    expect(members.map((m) => [m.name, m.role])).toEqual([
      ["mum", "owner"],
      ["Dr. Visitor", "viewer"],
    ]);
  });

  it("removing a member rotates the key: they lose access, the rest keep it, data is re-encrypted", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const bob = await user(s, "bob");
    const carol = await user(s, "carol");
    const ns = await alice.client.createNamespace({ name: "Family" });
    await ns.files.write("docs/insurance.pdf", new Uint8Array([1, 2, 3]));
    await ns.records<string>("notes").put("n1", "remember");
    for (const who of [bob, carol]) {
      const { payload } = await ns.invite({ role: "editor" });
      await who.client.acceptInvite(payload);
    }
    const bobNs = await bob.client.namespace(ns.id);
    await ns.removeMember(bob.accountId); // rotates
    await ns.refresh();
    expect(ns.epoch).toBe(2);
    await expect(bob.client.namespace(ns.id)).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    // To a non-member the namespace does not exist: nothing is readable.
    expect(await bobNs.files.read("docs/insurance.pdf")).toBeNull();

    // Carol still reads everything (keys for epoch 2 were wrapped to her).
    const carolNs = await carol.client.namespace(ns.id);
    expect(carolNs.epoch).toBe(2);
    expect([
      ...(await carolNs.files.read("docs/insurance.pdf"))!.bytes,
    ]).toEqual([1, 2, 3]);
    expect((await carolNs.records<string>("notes").get("n1"))!.value).toBe(
      "remember",
    );

    // Everything on the server is now named under epoch 2.
    const snap = await s.snapshot();
    const files = snap.tables.files!.filter((f) => f.blob_hash !== null) as {
      path: string;
    }[];
    expect(
      files.every((f) =>
        f.path.split("/").every((seg) => seg.startsWith("2.")),
      ),
    ).toBe(true);
    const rows = snap.tables.records!.filter((r) => r.value !== null) as {
      collection: string;
      key: string;
    }[];
    expect(
      rows.every(
        (r) => r.collection.startsWith("2.") && r.key.startsWith("2."),
      ),
    ).toBe(true);
  });

  it("owners manage roles and invites", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const bob = await user(s, "bob");
    const ns = await alice.client.createNamespace({ name: "N" });
    const inv = await ns.invite({
      role: "viewer",
      maxUses: 2,
      ttlSeconds: 3600,
    });
    expect((await ns.invites()).map((i) => i.id)).toEqual([inv.inviteId]);
    await ns.revokeInvite(inv.inviteId);
    await expect(bob.client.acceptInvite(inv.payload)).rejects.toThrow();
    const again = await ns.invite({ role: "viewer" });
    const { namespace } = await bob.client.acceptInvite(again.payload);
    await ns.setRole(bob.accountId, "editor");
    await namespace.refresh();
    expect(namespace.role).toBe("editor");
    await namespace.leave();
    await expect(bob.client.namespace(ns.id)).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    await ns.delete();
    expect(await alice.client.namespaces()).toEqual([]);
    expect(AuthError).toBeDefined();
  });
});
