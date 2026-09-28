// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// This account's devices, as Storage Remote's "This phone" page lists them:
// which devices exist and which wait for the account key, renaming and
// revoking. Approving a device, adding one by QR and a new recovery key
// hand out the account key or a credential: a person does those at a
// terminal (`storage-mcp device approve|add`, `storage-mcp recovery-key`),
// never the agent.

import { s } from "../protocol/schema.ts";
import { cleanName } from "../text.ts";
import { arg, iso } from "./common.ts";
import { json, text, type ToolDef, ToolError } from "./registry.ts";

const base = { groups: ["devices"], perm: "devices" } as const;

export const deviceTools: ToolDef[] = [
  {
    name: "list_my_devices",
    title: "Devices of this account",
    description:
      "This account's devices: platform, whether it has the account key, last seen, revoked.",
    ...base,
    access: "read",
    input: s.object({}),
    async run(_a, d) {
      const all = await d.client.devices();
      return json({
        devices: all.map((x) => ({
          id: x.id,
          name: x.name,
          platform: x.platform,
          hasAccountKey: x.hasAccountKey,
          lastSeen: iso(x.lastSeenAt),
          revoked: x.revokedAt !== null,
          thisAgent: x.id === d.session.me.deviceId,
        })),
      });
    },
  },
  {
    name: "list_pending_devices",
    title: "Devices waiting for the key",
    description:
      "Devices of this account that were paired but have no account key yet. Only a person approves one, after comparing safety codes: in Storage Remote, or with `storage-mcp device approve` at a terminal. Tell them; you cannot approve it.",
    ...base,
    access: "read",
    input: s.object({}),
    async run(_a, d) {
      const waiting = await d.client.pendingDevices();
      return json({
        pending: waiting.map((x) => ({
          id: x.id,
          name: x.name,
          platform: x.platform,
          paired: iso(x.createdAt),
        })),
      });
    },
  },
  {
    name: "rename_device",
    title: "Rename a device",
    description: "Rename one of this account's devices.",
    ...base,
    access: "write",
    idempotent: true,
    input: s.object(
      {
        deviceId: arg.id("The device id."),
        name: s.string("The new name.", { minLength: 1, maxLength: 64 }),
      },
      ["deviceId", "name"],
    ),
    async run(a, d) {
      await d.client.renameDevice(a.deviceId as string, cleanName(a.name, 64));
      return text("Renamed.", { deviceId: a.deviceId });
    },
  },
  {
    name: "revoke_my_device",
    title: "Revoke one of this account's devices",
    description:
      "Sign a device of this account out for good and delete its copy of the account key (a lost phone).",
    ...base,
    access: "write",
    destructive: true,
    idempotent: true,
    input: s.object({ deviceId: arg.id("The device id.") }, ["deviceId"]),
    async confirm(a, d) {
      if (a.deviceId === d.session.me.deviceId)
        throw new ToolError(
          "this is the agent's own device: use `storage-mcp unpair`",
        );
      const x = (await d.client.devices()).find((p) => p.id === a.deviceId);
      if (!x) throw new ToolError("no such device");
      return {
        message: `Revoke "${cleanName(x.name)}"? It is signed out now and its copy of your key is deleted.`,
      };
    },
    async run(a, d) {
      await d.client.revokeDevice(a.deviceId as string);
      return text("Revoked.", { revoked: a.deviceId });
    },
  },
];
