// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Helpers that drive the framework client against a test server — a paired,
// ready-to-use `SelfHostedClient` in one call. Import from
// "@niclaslindstedt/storage-testkit/client" (needs @niclaslindstedt/oss-framework).

import {
  createMemoryKeyVault,
  createSelfHostedClient,
  type KeyVault,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage";

import type { AccountRole, TestServer } from "./control.ts";

export type TestDevice = {
  client: SelfHostedClient;
  accountId: string;
  /** Only for the account's first device. */
  recoveryKey?: string;
};

/** Create an account on the test server and pair a first device to it. */
export async function createTestUser(
  server: TestServer,
  name: string,
  options: {
    app: string;
    role?: AccountRole;
    vault?: KeyVault;
    deviceName?: string;
  },
): Promise<TestDevice> {
  const seeded = await server.createAccount(name, {
    role: options.role ?? "member",
  });
  const client = createSelfHostedClient({
    app: options.app,
    vault: options.vault ?? createMemoryKeyVault(),
  });
  await client.pair(seeded.pairingUri, {
    name: options.deviceName ?? `${name}-device`,
    platform: "test",
  });
  const recoveryKey = await client.createAccountKeys();
  return { client, accountId: seeded.account.id, recoveryKey };
}

/** Add another device to an account via a device-to-device pairing QR. */
export async function addTestDevice(
  existing: SelfHostedClient,
  options: { app: string; vault?: KeyVault; deviceName?: string },
): Promise<SelfHostedClient> {
  const { payload } = await existing.addDevicePayload();
  const client = createSelfHostedClient({
    app: options.app,
    vault: options.vault ?? createMemoryKeyVault(),
  });
  await client.pair(payload, {
    name: options.deviceName ?? "second-device",
    platform: "test",
  });
  return client;
}
