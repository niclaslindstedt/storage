// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The one framework client the app runs on: this phone as a device of the
// hoster's admin account. Keys live in the native keystore when the wrapper
// offers one (`__ossKeyVault`), else in IndexedDB as non-extractable keys.

import {
  createSelfHostedClient,
  defaultKeyVault,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

/** The app id the drive's shared folders are created and listed under. */
export const DRIVE_APP = "drive";

export function createClient(): SelfHostedClient {
  return createSelfHostedClient({
    vault: defaultKeyVault("storage-remote"),
    app: DRIVE_APP,
  });
}

/** What this device calls itself, until the user names it. */
export function defaultDeviceName(ua = navigator.userAgent): string {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  return "Storage Remote";
}

/** The platform the server lists this device under ([a-z0-9-]). */
export function platformOf(ua = navigator.userAgent): string {
  if (/iPhone|iPad/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "web";
}

/** What /v1/me says about this device's console access (SPEC §11.2). */
export async function isAdminDevice(
  client: SelfHostedClient,
): Promise<boolean> {
  const me = await client.transport.json<{ console?: boolean }>(
    "GET",
    "/v1/me",
  );
  return me.console === true;
}
