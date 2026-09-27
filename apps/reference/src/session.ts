// How the app finds its server and keeps its keys. Everything is driven by
// URL parameters so a test can open the app as any device of any person:
//   ?profile=<name>   separate key vault (a separate "device") per profile
//   #oss=<payload>    an app link from a QR code (pairing or invite)

import {
  createIndexedDbKeyVault,
  createSelfHostedClient,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage";

export const APP_ID = "reference";

export function profile(): string {
  return new URLSearchParams(location.search).get("profile") ?? "default";
}

export function createClient(): SelfHostedClient {
  return createSelfHostedClient({
    app: APP_ID,
    vault: createIndexedDbKeyVault({ name: `${APP_ID}:${profile()}` }),
  });
}

/** A payload handed over in the URL fragment (`#oss=…`), consumed once. */
export function takeLinkedPayload(): string | null {
  if (!location.hash.startsWith("#oss=")) return null;
  const payload = location.href;
  history.replaceState(null, "", location.pathname + location.search);
  return payload;
}

/** The app's own URL, for app links in QR codes. */
export function appUrl(): string {
  return `${location.origin}${location.pathname}`;
}
