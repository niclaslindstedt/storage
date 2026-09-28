// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only network access the MCP server has: its own storage server.
//
// - One origin. Every request must go to the server the device is paired
//   with; anything else is refused before it leaves the process, so no
//   tool argument, invite or server response can turn this process into a
//   client of some other host (SSRF, data exfiltration).
// - HTTPS only, except to a loopback address (a server on this machine or
//   behind an SSH tunnel) or when explicitly allowed for tests.
// - No redirects: a storage server never redirects its API.
// - Certificate pinning for self-signed servers: when the pairing code
//   carried the server's SPKI fingerprint (`fp`), the TLS connection is
//   accepted only if the server's key hashes to it — no CA involved.

import { createHash, X509Certificate } from "node:crypto";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type NetOptions = {
  /** Allow plain http:// to a non-loopback host (tests only). */
  allowInsecureHttp?: boolean;
  /** base64url SHA-256 of the server's SubjectPublicKeyInfo (self-signed). */
  pin?: string;
};

export class NetError extends Error {}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/** Check a server URL before pairing with it or talking to it. */
export function checkServerUrl(url: string, opts: NetOptions = {}): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new NetError(`not a URL: ${url}`);
  }
  if (u.username || u.password)
    throw new NetError("a server URL must not carry credentials");
  if (u.protocol === "https:") return u;
  if (
    u.protocol === "http:" &&
    (isLoopbackHost(u.hostname) || opts.allowInsecureHttp)
  )
    return u;
  throw new NetError(
    `refusing ${u.protocol}//${u.host}: the storage server must use HTTPS (plain HTTP only to this machine)`,
  );
}

export function spkiFingerprint(cert: X509Certificate): string {
  const der = cert.publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64url");
}

/** A fetch confined to one server origin. */
export function serverFetch(
  server: string,
  opts: NetOptions = {},
): typeof fetch {
  const origin = checkServerUrl(server, opts).origin;
  const pinned = opts.pin ? pinnedFetch(opts.pin) : null;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.origin !== origin)
      throw new NetError(
        `refusing a request to ${url.origin}: this agent talks to ${origin} only`,
      );
    if (pinned && url.protocol === "https:") return pinned(url, init);
    return fetch(url, { ...init, redirect: "error" });
  }) as typeof fetch;
}

/**
 * fetch over TLS that accepts exactly one server key. The key is checked
 * when the handshake completes, before a single byte of the request (and
 * its bearer token) is written.
 */
function pinnedFetch(pin: string) {
  const connectPinned = (url: URL): Promise<TLSSocket> =>
    new Promise((resolve, reject) => {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const socket = tlsConnect({
        host,
        port: Number(url.port || 443),
        servername: isIP(host) ? undefined : host,
        // The CA chain is not what we trust here: the pinned key is.
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      });
      socket.once("secureConnect", () => {
        const cert = socket.getPeerX509Certificate();
        if (!cert || spkiFingerprint(cert) !== pin) {
          socket.destroy();
          reject(
            new NetError(
              "the server's certificate does not match the pinned fingerprint",
            ),
          );
          return;
        }
        resolve(socket);
      });
      socket.once("error", reject);
    });

  return async (url: URL, init: RequestInit = {}): Promise<Response> => {
    const socket = await connectPinned(url);
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const req = httpRequest(
        {
          host: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: init.method ?? "GET",
          headers: { ...headers, host: url.host },
          // No agent: with createConnection alone, Node uses exactly this
          // (already verified) socket for the request.
          createConnection: () => socket,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            reject(new NetError("the server answered with a redirect"));
            return;
          }
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) for (const x of v) h.append(k, x);
            else if (v !== undefined) h.set(k, v);
          }
          const body =
            status === 204 || status === 304 || init.method === "HEAD"
              ? null
              : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
          resolve(new Response(body, { status, headers: h }));
        },
      );
      req.on("error", reject);
      init.signal?.addEventListener("abort", () =>
        req.destroy(new Error("aborted")),
      );
      const body = init.body;
      if (body === undefined || body === null) req.end();
      else if (typeof body === "string" || body instanceof Uint8Array)
        req.end(body);
      else if (body instanceof ArrayBuffer) req.end(new Uint8Array(body));
      else {
        req.destroy();
        reject(new NetError("unsupported request body"));
      }
    });
  };
}
