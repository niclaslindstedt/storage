// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A small HTTP client on node:http / node:https (no dependencies). HTTPS is
// verified against the system CAs (plus NODE_EXTRA_CA_CERTS), or — for a
// server with a self-signed certificate — against a pinned SPKI SHA-256
// fingerprint, checked on a connected socket before a single request byte
// is written.

import { createHash, X509Certificate } from "node:crypto";
import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  request as httpRequest,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { isIP } from "node:net";

export type HttpRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Pin the server's TLS key instead of verifying the chain. */
  fp?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

/** The server could not be reached (DNS, refused, TLS, pin mismatch). */
export class NetworkError extends Error {
  constructor(
    readonly url: string,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/** SHA-256 of the peer certificate's SubjectPublicKeyInfo (DER), base64url. */
export function spkiFingerprint(socket: TLSSocket): string | null {
  const cert = socket.getPeerCertificate();
  // `pubkey` is the raw key (an EC point), not the SPKI the server's `fp`
  // hashes: derive the SPKI from the certificate itself.
  if (!cert?.raw) return null;
  const spki = new X509Certificate(cert.raw).publicKey.export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(spki).digest("base64url");
}

function pinnedSocket(url: URL, fp: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const socket = tlsConnect({
      host,
      port: Number(url.port || 443),
      servername: isIP(host) ? undefined : host,
      // The chain of a self-signed certificate never verifies; the pinned
      // key below is the check instead.
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const got = spkiFingerprint(socket);
      if (got !== fp) {
        socket.destroy();
        reject(
          new NetworkError(
            url.origin,
            `the server's TLS key does not match the pinned fingerprint (expected ${fp}, got ${got ?? "none"}) — refusing to talk to it`,
            "PIN_MISMATCH",
          ),
        );
        return;
      }
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

/** Send a request; resolves with the response head and a readable body. */
export async function open(req: HttpRequest): Promise<IncomingMessage> {
  const url = new URL(req.url);
  const https = url.protocol === "https:";
  if (!https && url.protocol !== "http:")
    throw new NetworkError(
      url.origin,
      `unsupported URL scheme ${url.protocol}`,
    );
  const socket = https && req.fp ? await pinnedSocket(url, req.fp) : null;
  const headers: Record<string, string> = {
    "User-Agent": "storage-cli",
    Accept: "application/json",
    ...req.headers,
  };
  if (req.body !== undefined)
    headers["Content-Length"] = String(Buffer.byteLength(req.body));
  return new Promise((resolve, reject) => {
    const options = {
      method: req.method,
      headers,
      signal: req.signal,
      // With no agent, the request runs on the verified socket as is.
      ...(socket ? { createConnection: () => socket } : {}),
    };
    const r = (https ? httpsRequest : httpRequest)(url, options, resolve);
    r.setTimeout(req.timeoutMs ?? 30_000, () =>
      r.destroy(
        new NetworkError(
          url.origin,
          "the server did not answer in time",
          "TIMEOUT",
        ),
      ),
    );
    r.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof NetworkError || err.name === "AbortError")
        return reject(err);
      reject(new NetworkError(url.origin, err.message, err.code));
    });
    r.end(req.body);
  });
}

export async function send(req: HttpRequest): Promise<HttpResponse> {
  const res = await open(req);
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  return {
    status: res.statusCode ?? 0,
    headers: res.headers,
    body: Buffer.concat(chunks),
  };
}

/** Parse a Server-Sent Events stream, calling `on` per event. */
export async function readEvents(
  res: IncomingMessage,
  on: (event: string, data: string) => void,
): Promise<void> {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  res.setEncoding("utf8");
  for await (const chunk of res) {
    buffer += chunk as string;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line === "") {
        if (data.length) on(event, data.join("\n"));
        event = "message";
        data = [];
      } else if (line.startsWith(":")) {
        continue;
      } else {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
    }
  }
}
