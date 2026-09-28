// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where the wrapper points its WebView, and the colours it paints before the
// page reports its own. By default the app is SELF-CONTAINED: it serves the
// Storage Remote build packed inside it (assets/webroot.zip) from a loopback
// server. `EXPO_PUBLIC_REMOTE_URL` points a debug build at a dev server
// instead; a store build must not set it.

export const REMOTE_URL: string | undefined =
  process.env.EXPO_PUBLIC_REMOTE_URL;

/** The console's light background and text (its --bg and --text). */
export const FALLBACK_BACKGROUND = "#f5f6f9";
export const FALLBACK_FOREGROUND = "#141a26";
