// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// This account's devices, as Storage Remote's "This phone" page has them:
// devices waiting for the account key (approved only after a person
// compares safety codes — typed by the person, never by the model), adding
// a device by QR (the payload carries the account key: outbox only), a new
// recovery key (outbox only), renaming and revoking.

import { s } from "../protocol/schema.ts";
import { cleanName } from "../text.ts";
import { arg, iso } from "./common.ts";
import { json, text, type ToolDef, ToolError } from "./registry.ts";

const base = { groups: ["devices"], perm: "devices" } as const;

const digits = (code: string) => code.replace(/\D/g, "");

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
      "Devices of this account that were paired but have no account key yet. Approve one with approve_device — the person compares the safety codes.",
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
    name: "approve_device",
    title: "Approve a waiting device",
    description:
      "Give a waiting device the account key. The person is asked to type the safety code the new device shows; it must match the code computed here from the keys the account key will be sealed to. Needs a client that can ask the person.",
    ...base,
    access: "write",
    keys: true,
    input: s.object({ deviceId: arg.id("The waiting device's id (dev_…).") }, [
      "deviceId",
    ]),
    async confirm(a, d) {
      const x = (await d.client.pendingDevices()).find(
        (p) => p.id === a.deviceId,
      );
      if (!x) throw new ToolError("no such waiting device");
      return {
        message: `Approve "${cleanName(x.name)}" (${cleanName(x.platform)})? Only if that device shows the safety code you type below. If you did not just pair a device, someone else is trying to join your account: revoke it instead.`,
        input: {
          label: `Safety code shown on ${cleanName(x.name, 60)}`,
          description: "25 digits, as the new device shows them",
        },
        always: true,
      };
    },
    async run(a, d, extra) {
      // Computed here, from the keys the account key would be sealed to —
      // never the server's copy of the code.
      const x = (await d.client.pendingDevices()).find(
        (p) => p.id === a.deviceId,
      );
      if (!x) throw new ToolError("no such waiting device");
      if (!extra.answer || digits(extra.answer) !== digits(x.safetyCode))
        throw new ToolError(
          "The safety codes do not match; the device was NOT approved. If the person did not just pair it, revoke it.",
        );
      await d.client.approveDevice(x.id);
      return text(`${cleanName(x.name)} can now open the account's data.`, {
        approved: x.id,
      });
    },
  },
  {
    name: "add_device",
    title: "Add a device by QR",
    description:
      "A one-time QR payload that pairs a new device to this account with the account key sealed inside it, so the new device is ready at once.",
    ...base,
    access: "write",
    keys: true,
    secret: true,
    input: s.object({
      ttlMinutes: s.integer("Valid for this many minutes (default 10).", 1, 60),
    }),
    confirm: () => ({
      message:
        "Create a one-time code that adds a device to your account and gives it your account key (everything you can read)? It will be written to a private file for you to scan.",
    }),
    async run(a, d) {
      const out = await d.client.addDevicePayload({
        ttlSeconds: ((a.ttlMinutes as number | undefined) ?? 10) * 60,
      });
      const delivered = d.outbox.deliver("add-device", out.payload, {
        title: "Add a device (single use)",
        note: "Scan the QR code (the .svg next to this file) with the new device's app.",
        expiresAt: out.expiresAt,
        qr: true,
      });
      return text(
        `The code was written for the person to ${delivered.file} (QR: ${delivered.qr}); it expires ${delivered.expiresAt}. Tell them where it is; do not open it.`,
        { delivered },
      );
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
  {
    name: "new_recovery_key",
    title: "Make a new recovery key",
    description:
      "Replace the account's recovery key; the old one stops working at once. The new key is written to a private file for the person.",
    ...base,
    access: "write",
    keys: true,
    secret: true,
    destructive: true,
    input: s.object({}),
    confirm: () => ({
      message:
        "Make a new recovery key? The old one stops working at once. The new one will be written to a private file for you to store safely.",
      always: true,
    }),
    async run(_a, d) {
      const key = await d.client.regenerateRecoveryKey();
      const delivered = d.outbox.deliver("recovery-key", key, {
        title: "Your new recovery key",
        note: "The only way back to your data if every device is lost. Store it in a password manager or on paper, then delete this file.",
      });
      return text(
        `The new recovery key was written for the person to ${delivered.file}. Tell them to store it safely and delete the file; do not open it.`,
        { delivered: { file: delivered.file } },
      );
    },
  },
];
