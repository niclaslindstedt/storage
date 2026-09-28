// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Sharing a namespace with other accounts: members and roles, invites
// (their secret goes to the outbox, never to the model), joining someone
// else's folder, and key rotation after removing a member. Sharing is how
// data leaves an account, so each step that widens access asks the person.

import { parseStoragePayload } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { s } from "../protocol/schema.ts";
import { cleanName, formatBytes } from "../text.ts";
import { arg, iso, openNamespace } from "./common.ts";
import { json, text, type ToolDef, ToolError } from "./registry.ts";

const ROLE = s.enum("The member's role.", ["editor", "viewer"]);

export const sharingTools: ToolDef[] = [
  {
    name: "list_members",
    title: "Members of a shared folder",
    description: "Who a namespace is shared with, and their roles.",
    groups: ["files", "sharing"],
    access: "read",
    perm: "data:read",
    keys: true,
    input: s.object({ namespace: arg.namespace }, ["namespace"]),
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      const members = await ns.members();
      return json({
        members: members.map((m) => ({
          accountId: m.accountId,
          name: m.name,
          role: m.role,
          you: m.accountId === d.session.me.account.id,
          hasKey: m.hasKey,
        })),
      });
    },
  },
  {
    name: "list_invites",
    title: "Open invites",
    description: "The invites of a namespace you own: role, uses, expiry.",
    groups: ["sharing"],
    access: "read",
    perm: "sharing",
    keys: true,
    input: s.object({ namespace: arg.namespace }, ["namespace"]),
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      const invites = await ns.invites();
      return json({
        invites: invites.map((i) => ({ ...i, expires: iso(i.expiresAt) })),
      });
    },
  },
  {
    name: "create_invite",
    title: "Invite someone to a shared folder",
    description:
      "Create an invite to a namespace you own. It carries the folder's key, sealed under a secret only the invite holds; whoever redeems it can read (viewer) or change (editor) the folder.",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    secret: true,
    input: s.object(
      {
        namespace: arg.namespace,
        role: ROLE,
        ttlHours: s.integer(
          "Valid for this many hours (default 168).",
          1,
          24 * 30,
        ),
        maxUses: s.integer("How many people may use it (default 1).", 1, 20),
      },
      ["namespace"],
    ),
    async confirm(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      if (ns.role !== "owner") throw new ToolError("only the owner can invite");
      return {
        message: `Create an invite that lets ${String(a.maxUses ?? 1)} person(s) ${a.role === "editor" ? "read and change" : "read"} everything in "${cleanName(ns.meta.name)}" (${formatBytes(ns.info.usedBytes)})? It will be written to a private file for you to hand over.`,
      };
    },
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      const inv = await ns.invite({
        role: (a.role as "editor" | "viewer" | undefined) ?? "viewer",
        ttlSeconds: ((a.ttlHours as number | undefined) ?? 168) * 3600,
        maxUses: (a.maxUses as number | undefined) ?? 1,
      });
      const delivered = d.outbox.deliver("invite", inv.payload, {
        title: `Invite to ${cleanName(ns.meta.name)}`,
        note: "Show the QR code (the .svg next to this file) to the person you invite, or send them the link over a channel you trust.",
        expiresAt: inv.expiresAt,
        qr: true,
      });
      return text(
        `The invite was written for the person to ${delivered.file} (QR: ${delivered.qr}); it expires ${delivered.expiresAt}. Tell them where it is; do not open it.`,
        { inviteId: inv.inviteId, delivered },
      );
    },
  },
  {
    name: "revoke_invite",
    title: "Revoke an invite",
    description: "Make an unused invite stop working.",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    idempotent: true,
    input: s.object(
      { namespace: arg.namespace, inviteId: arg.id("The invite id.") },
      ["namespace", "inviteId"],
    ),
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      await ns.revokeInvite(a.inviteId as string);
      return text("Revoked.", { revoked: a.inviteId });
    },
  },
  {
    name: "set_member_role",
    title: "Change a member's role",
    description: "Make a member an editor or a viewer.",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    idempotent: true,
    input: s.object(
      {
        namespace: arg.namespace,
        accountId: s.string("The member's account id.", { maxLength: 64 }),
        role: ROLE,
      },
      ["namespace", "accountId", "role"],
    ),
    async confirm(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      const m = (await ns.members()).find((x) => x.accountId === a.accountId);
      if (!m) throw new ToolError("no such member");
      return {
        message: `Make ${cleanName(m.name)} ${String(a.role)} of "${cleanName(ns.meta.name)}"?`,
      };
    },
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      await ns.setRole(a.accountId as string, a.role as "editor" | "viewer");
      return text("Changed.", { accountId: a.accountId, role: a.role });
    },
  },
  {
    name: "remove_member",
    title: "Remove a member",
    description:
      "Remove a member from a namespace you own and (by default) rotate its key, re-encrypting what is in it, so they cannot read anything written from now on.",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    destructive: true,
    input: s.object(
      {
        namespace: arg.namespace,
        accountId: s.string("The member's account id.", { maxLength: 64 }),
        rotate: s.boolean("Rotate the key afterwards (default true)."),
      },
      ["namespace", "accountId"],
    ),
    async confirm(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      const m = (await ns.members()).find((x) => x.accountId === a.accountId);
      if (!m) throw new ToolError("no such member");
      return {
        message: `Remove ${cleanName(m.name)} from "${cleanName(ns.meta.name)}"?`,
      };
    },
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      await ns.removeMember(a.accountId as string, {
        rotate: a.rotate !== false,
      });
      return text("Removed.", {
        removed: a.accountId,
        rotated: a.rotate !== false,
      });
    },
  },
  {
    name: "rotate_namespace_key",
    title: "Rotate a folder's key",
    description:
      "Give a namespace you own a new key and re-encrypt its files and rows under it (after a device or member was lost).",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    input: s.object({ namespace: arg.namespace }, ["namespace"]),
    async run(a, d) {
      const ns = await openNamespace(d, a.namespace as string);
      return json(await ns.rotateKey());
    },
  },
  {
    name: "join_shared_folder",
    title: "Join a shared folder",
    description:
      "Redeem an invite someone gave the person (oss-storage://invite?… or an app link). Only invites to this agent's own server are accepted.",
    groups: ["sharing"],
    access: "write",
    perm: "sharing",
    keys: true,
    input: s.object(
      {
        invite: s.string("The invite link.", {
          minLength: 10,
          maxLength: 4096,
        }),
      },
      ["invite"],
    ),
    confirm: (a, d) => {
      const p = parseStoragePayload(a.invite as string);
      if (p.kind !== "invite")
        throw new ToolError("that is a pairing code, not an invite");
      if (
        p.server.replace(/\/+$/, "") !==
        d.session.profile.server.replace(/\/+$/, "")
      )
        throw new ToolError("that invite is for another server");
      return {
        message: `Join a folder shared with you as ${p.role}? Its owner will see this account as a member, and the agent will be able to ${p.role === "editor" ? "write to" : "read"} it.`,
      };
    },
    async run(a, d) {
      const { namespace } = await d.client.acceptInvite(a.invite as string);
      return json({
        id: namespace.id,
        name: namespace.meta.name,
        app: namespace.app,
        role: namespace.role,
      });
    },
  },
];
