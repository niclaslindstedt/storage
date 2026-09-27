import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.ts";
import type { HubEvent } from "../src/events.ts";
import {
  acceptInvite,
  createInvite,
  listInvites,
  revokeInvite,
} from "../src/services/invites.ts";
import {
  addKeyWraps,
  createNamespace,
  deleteNamespace,
  getNamespace,
  listMembers,
  listNamespaces,
  removeMember,
  rotateNamespace,
  updateMemberRole,
  updateNamespaceMeta,
} from "../src/services/namespaces.ts";
import { newSecret } from "../src/util/random.ts";
import {
  deviceKeys,
  envelopeB64u,
  principal,
  testContext,
  WRAP,
} from "./helpers.ts";

async function expectApiError(
  p: Promise<unknown> | (() => unknown),
  code: string,
) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    return err as ApiError;
  }
  throw new Error(`expected ApiError ${code}`);
}

describe("namespaces", () => {
  it("creates, lists per app and hides from non-members", async () => {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const bob = principal(ctx, "bob");
    const ns = createNamespace(ctx, alice, {
      app: "meds",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    expect(ns).toMatchObject({
      app: "meds",
      role: "owner",
      epoch: 1,
      keys: { "1": WRAP },
    });
    createNamespace(ctx, alice, {
      app: "notes",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    expect(listNamespaces(ctx, alice, "meds").map((n) => n.id)).toEqual([
      ns.id,
    ]);
    expect(listNamespaces(ctx, alice)).toHaveLength(2);
    expect(listNamespaces(ctx, bob)).toEqual([]);
    await expectApiError(() => getNamespace(ctx, bob, ns.id), "not_found");
  });

  it("accepts a client-chosen id (the client derives keys from it) and refuses duplicates", async () => {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const id = "ns_AAAAAAAAAAAAAAAAAAAAAA";
    const ns = createNamespace(ctx, alice, {
      id,
      app: "meds",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    expect(ns.id).toBe(id);
    await expectApiError(
      () =>
        createNamespace(ctx, alice, {
          id,
          app: "meds",
          meta: envelopeB64u(),
          wrap: WRAP,
        }),
      "conflict",
    );
    await expectApiError(
      () =>
        createNamespace(ctx, alice, {
          id: "ns_bad",
          app: "meds",
          meta: envelopeB64u(),
          wrap: WRAP,
        }),
      "invalid_request",
    );
  });

  it("guests cannot create namespaces; meta must be a current-epoch envelope", async () => {
    const ctx = testContext();
    const guest = principal(ctx, "g", "guest");
    const alice = principal(ctx, "alice");
    await expectApiError(
      () =>
        createNamespace(ctx, guest, {
          app: "meds",
          meta: envelopeB64u(),
          wrap: WRAP,
        }),
      "forbidden",
    );
    await expectApiError(
      () =>
        createNamespace(ctx, alice, {
          app: "meds",
          meta: "bm90LWFuLWVudmVsb3Bl",
          wrap: WRAP,
        }),
      "invalid_request",
    );
    await expectApiError(
      () =>
        createNamespace(ctx, alice, {
          app: "Bad App",
          meta: envelopeB64u(),
          wrap: WRAP,
        }),
      "invalid_request",
    );
  });

  it("updates metadata with compare-and-swap and bumps seq", async () => {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const events: HubEvent[] = [];
    ctx.events.subscribe(alice.accountId, alice.deviceId, (e) =>
      events.push(e),
    );
    const ns = createNamespace(ctx, alice, {
      app: "notes",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    const updated = updateNamespaceMeta(
      ctx,
      alice,
      ns.id,
      envelopeB64u(1, 16, 9),
      ns.metaRev,
    );
    expect(Number(updated.seq)).toBeGreaterThan(Number(ns.seq));
    await expectApiError(
      () => updateNamespaceMeta(ctx, alice, ns.id, envelopeB64u(), ns.metaRev),
      "conflict",
    );
    expect(events).toContainEqual({
      type: "ns",
      ns: ns.id,
      seq: Number(updated.seq),
    });
  });
});

describe("members, invites and rotation", () => {
  async function shared() {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const bob = principal(ctx, "bob");
    const ns = createNamespace(ctx, alice, {
      app: "meds",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    const code = newSecret();
    const invite = createInvite(ctx, alice, ns.id, {
      role: "editor",
      code,
      payload: "c2VhbGVkLW5r",
    });
    return { ctx, alice, bob, ns, code, invite };
  }

  it("an invite adds an existing account as a member and returns the sealed payload", async () => {
    const { ctx, alice, bob, ns, code, invite } = await shared();
    expect(listInvites(ctx, alice, ns.id).map((i) => i.id)).toEqual([
      invite.inviteId,
    ]);
    const res = await acceptInvite(
      ctx,
      bob,
      { code },
      { ip: null, origin: null },
    );
    expect(res).toMatchObject({
      namespaceId: ns.id,
      role: "editor",
      payload: "c2VhbGVkLW5r",
      app: "meds",
    });
    expect(getNamespace(ctx, bob, ns.id).role).toBe("editor");
    // single use by default
    const carol = principal(ctx, "carol");
    await expectApiError(
      acceptInvite(ctx, carol, { code }, { ip: null, origin: null }),
      "not_found",
    );
    // bob stores his own key wrap
    addKeyWraps(ctx, bob, ns.id, {
      epoch: 1,
      wraps: { [bob.accountId]: WRAP },
    });
    expect(getNamespace(ctx, bob, ns.id).keys).toEqual({ "1": WRAP });
    await expectApiError(
      () =>
        addKeyWraps(ctx, bob, ns.id, {
          epoch: 1,
          wraps: { [alice.accountId]: WRAP },
        }),
      "forbidden",
    );
  });

  it("an invite can enrol a brand-new guest with a device", async () => {
    const { ctx, ns, code } = await shared();
    const keys = await deviceKeys();
    const res = await acceptInvite(
      ctx,
      null,
      {
        code,
        accountName: "Dr. Visitor",
        device: { name: "Tablet", platform: "web", ...keys },
      },
      { ip: "1.1.1.1", origin: "https://meds.example" },
    );
    expect(res.deviceId).toMatch(/^dev_/);
    const members = ctx.db.all<{ role: string }>(
      "SELECT a.role FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.namespace_id = ?",
      ns.id,
    );
    expect(members.map((m) => m.role).sort()).toEqual(["guest", "member"]);
  });

  it("viewers are read-only; owners manage roles; the last owner stays", async () => {
    const { ctx, alice, bob, ns, code } = await shared();
    await acceptInvite(ctx, bob, { code }, { ip: null, origin: null });
    updateMemberRole(ctx, alice, ns.id, bob.accountId, "viewer");
    await expectApiError(
      () => updateNamespaceMeta(ctx, bob, ns.id, envelopeB64u()),
      "forbidden",
    );
    await expectApiError(
      () => updateMemberRole(ctx, bob, ns.id, alice.accountId, "viewer"),
      "forbidden",
    );
    await expectApiError(
      () => updateMemberRole(ctx, alice, ns.id, alice.accountId, "editor"),
      "conflict",
    );
    expect(
      listMembers(ctx, bob, ns.id)
        .map((m) => m.role)
        .sort(),
    ).toEqual(["owner", "viewer"]);
  });

  it("removing a member drops their wraps; rotation must cover every member", async () => {
    const { ctx, alice, bob, ns, code } = await shared();
    await acceptInvite(ctx, bob, { code }, { ip: null, origin: null });
    addKeyWraps(ctx, bob, ns.id, {
      epoch: 1,
      wraps: { [bob.accountId]: WRAP },
    });
    const removedEvents: HubEvent[] = [];
    ctx.events.subscribe(bob.accountId, bob.deviceId, (e) =>
      removedEvents.push(e),
    );
    removeMember(ctx, alice, ns.id, bob.accountId);
    expect(removedEvents).toContainEqual({ type: "namespaces" });
    expect(
      ctx.db.get("SELECT 1 FROM key_wraps WHERE account_id = ?", bob.accountId),
    ).toBeUndefined();
    await expectApiError(() => getNamespace(ctx, bob, ns.id), "not_found");

    await expectApiError(
      () =>
        rotateNamespace(ctx, alice, ns.id, {
          epoch: 3,
          wraps: { [alice.accountId]: WRAP },
        }),
      "conflict",
    );
    const rotated = rotateNamespace(ctx, alice, ns.id, {
      epoch: 2,
      wraps: { [alice.accountId]: "bmV3LXdyYXA" },
    });
    expect(rotated.epoch).toBe(2);
    expect(rotated.keys).toEqual({ "1": WRAP, "2": "bmV3LXdyYXA" });
    // new writes must use the new epoch
    await expectApiError(
      () => updateNamespaceMeta(ctx, alice, ns.id, envelopeB64u(1)),
      "invalid_request",
    );
    updateNamespaceMeta(ctx, alice, ns.id, envelopeB64u(2));
  });

  it("rotation refuses to skip a member", async () => {
    const { ctx, alice, bob, ns, code } = await shared();
    await acceptInvite(ctx, bob, { code }, { ip: null, origin: null });
    await expectApiError(
      () =>
        rotateNamespace(ctx, alice, ns.id, {
          epoch: 2,
          wraps: { [alice.accountId]: WRAP },
        }),
      "invalid_request",
    );
  });

  it("members can leave; invites expire and can be revoked", async () => {
    const { ctx, alice, bob, ns, code, invite } = await shared();
    revokeInvite(ctx, alice, ns.id, invite.inviteId);
    await expectApiError(
      acceptInvite(ctx, bob, { code }, { ip: null, origin: null }),
      "not_found",
    );
    const code2 = newSecret();
    createInvite(ctx, alice, ns.id, {
      role: "viewer",
      code: code2,
      payload: "eA",
      ttlSeconds: 60,
    });
    ctx.clock.advance(61_000);
    await expectApiError(
      acceptInvite(ctx, bob, { code: code2 }, { ip: null, origin: null }),
      "not_found",
    );
    const code3 = newSecret();
    createInvite(ctx, alice, ns.id, {
      role: "viewer",
      code: code3,
      payload: "eA",
    });
    await acceptInvite(ctx, bob, { code: code3 }, { ip: null, origin: null });
    removeMember(ctx, bob, ns.id, bob.accountId);
    expect(listNamespaces(ctx, bob)).toEqual([]);
  });

  it("owners delete a namespace for everyone", async () => {
    const { ctx, alice, bob, ns, code } = await shared();
    await acceptInvite(ctx, bob, { code }, { ip: null, origin: null });
    await expectApiError(deleteNamespace(ctx, bob, ns.id), "forbidden");
    await deleteNamespace(ctx, alice, ns.id);
    expect(listNamespaces(ctx, alice)).toEqual([]);
    expect(listNamespaces(ctx, bob)).toEqual([]);
  });
});
