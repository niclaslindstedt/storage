// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The admin console, reached from the phone. The console's own pages are
// mounted unchanged (packages/server/src/admin/ui); only their transport is
// swapped: requests to `/api/…` go to the server's `/v1/console/…` with this
// admin device's bearer token (SPEC §11.2), which the framework client signs
// in for with the device key.

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import type { ConsoleTransport } from "@storage/console/api.ts";

import { saveFile } from "./hosts.ts";
import { createSseParser } from "./sse.ts";

/** A console API path (`/api/x?y`, `/metrics`) on the device API. */
export function remotePath(path: string): string {
  if (path === "/metrics" || path.startsWith("/metrics?"))
    return `/v1/console${path}`;
  if (!path.startsWith("/api/"))
    throw new Error(`not a console API path: ${path}`);
  return `/v1/console/${path.slice(5)}`;
}

/** The file name a Content-Disposition header offers, or a fallback. */
export function fileNameFrom(header: string | null, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(header ?? "");
  return m?.[1] ?? fallback;
}

export function remoteTransport(
  client: SelfHostedClient,
  onSignedOut: () => void,
): ConsoleTransport {
  const url = (path: string) =>
    client.session!.serverUrl.replace(/\/+$/, "") + remotePath(path);

  async function send(
    method: string,
    path: string,
    init: { body?: string; headers?: Record<string, string> } = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const t = client.transport;
    const go = async (force: boolean) =>
      t.fetchImpl(url(path), {
        method,
        body: init.body,
        signal,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${await t.accessToken(force)}`,
        },
      });
    const res = await go(false);
    return res.status === 401 ? go(true) : res;
  }

  return {
    remote: true,
    fetch: (method, path, body, headers) =>
      send(method, path, { body, headers }),
    signedOut: onSignedOut,
    async download(path) {
      const res = await send("GET", path);
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await saveFile(
        fileNameFrom(res.headers.get("content-disposition"), "download"),
        res.headers.get("content-type") ?? "application/octet-stream",
        bytes,
      );
    },
    events(path, on) {
      const ac = new AbortController();
      void (async () => {
        let delay = 1000;
        while (!ac.signal.aborted) {
          try {
            const res = await send(
              "GET",
              path,
              { headers: { Accept: "text/event-stream" } },
              ac.signal,
            );
            if (res.status === 401) return onSignedOut();
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            on.open();
            delay = 1000;
            const parser = createSseParser(on.event);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              parser.feed(decoder.decode(value, { stream: true }));
            }
          } catch {
            if (ac.signal.aborted) return;
          }
          on.error();
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30_000);
        }
      })();
      return () => ac.abort();
    },
  };
}
