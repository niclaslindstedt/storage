// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// An ACME (RFC 8555) client for Let's Encrypt and compatible CAs: ES256
// account key, JWS-signed requests with nonce handling, `http-01` and
// `tls-alpn-01` (RFC 8737) challenges, `dns` and `ip` (RFC 8738)
// identifiers, and certificate profiles (short-lived IP certificates).

import { createHash, createPublicKey, sign, type KeyObject } from "node:crypto";
import { isIP } from "node:net";

import type { Logger } from "../log.ts";
import {
  buildCertificate,
  buildCsr,
  generateP256,
  loadKey,
  toPem,
} from "./x509.ts";

export type FetchImpl = typeof fetch;

export type ChallengeResponder = {
  http01?: {
    set(token: string, keyAuthorization: string): void;
    remove(token: string): void;
  };
  tlsAlpn01?: {
    /** Serve `certPem`/`keyPem` to `acme-tls/1` handshakes for `servername`. */
    set(servername: string, certPem: string, keyPem: string): void;
    remove(servername: string): void;
  };
};

export type AcmeOptions = {
  directoryUrl: string;
  accountKeyPem: string;
  /** A previously registered account URL (skips newAccount). */
  accountUrl?: string | null;
  contact?: string[];
  fetchImpl?: FetchImpl;
  log?: Logger;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type IssuedCertificate = {
  certPem: string;
  keyPem: string;
  notAfter: Date;
  accountUrl: string;
};

type Directory = { newNonce: string; newAccount: string; newOrder: string };

type Challenge = { type: string; url: string; token: string; status: string };
type Authorization = {
  status: string;
  identifier: { type: string; value: string };
  challenges: Challenge[];
};
type Order = {
  status: string;
  authorizations: string[];
  finalize: string;
  certificate?: string;
  error?: unknown;
};

const b64u = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");

/** The SNI a tls-alpn-01 validator sends for an identifier (RFC 8738 §6). */
export function alpnServername(identifier: string): string {
  if (isIP(identifier) === 4)
    return `${identifier.split(".").reverse().join(".")}.in-addr.arpa`;
  if (isIP(identifier) === 6) {
    const full = expandV6(identifier);
    return `${full.split("").reverse().join(".")}.ip6.arpa`;
  }
  return identifier;
}

function expandV6(ip: string): string {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = [...h, ...new Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.map((g) => g.padStart(4, "0")).join("");
}

export class AcmeClient {
  private readonly fetchImpl: FetchImpl;
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject };
  private readonly jwk: Record<string, string>;
  private dir: Directory | null = null;
  private nonce: string | null = null;
  private accountUrl: string | null;

  constructor(private readonly opts: AcmeOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.key = loadKey(opts.accountKeyPem);
    const jwk = createPublicKey(this.key.privateKey).export({
      format: "jwk",
    }) as Record<string, string>;
    this.jwk = { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! };
    this.accountUrl = opts.accountUrl ?? null;
  }

  /** RFC 7638 thumbprint of the account key. */
  thumbprint(): string {
    const { crv, kty, x, y } = this.jwk;
    return createHash("sha256")
      .update(JSON.stringify({ crv, kty, x, y }))
      .digest("base64url");
  }

  keyAuthorization(token: string): string {
    return `${token}.${this.thumbprint()}`;
  }

  private async directory(): Promise<Directory> {
    if (this.dir) return this.dir;
    const res = await this.fetchImpl(this.opts.directoryUrl);
    if (!res.ok) throw new Error(`ACME directory: HTTP ${res.status}`);
    this.dir = (await res.json()) as Directory;
    return this.dir;
  }

  private async freshNonce(): Promise<string> {
    if (this.nonce) {
      const n = this.nonce;
      this.nonce = null;
      return n;
    }
    const res = await this.fetchImpl((await this.directory()).newNonce, {
      method: "HEAD",
    });
    const n = res.headers.get("replay-nonce");
    if (!n) throw new Error("ACME: no Replay-Nonce");
    return n;
  }

  /** A JWS-signed POST; `payload === null` is POST-as-GET. */
  private async post(
    url: string,
    payload: unknown,
    useJwk = false,
    retried = false,
  ): Promise<Response> {
    const header: Record<string, unknown> = {
      alg: "ES256",
      nonce: await this.freshNonce(),
      url,
    };
    if (useJwk || !this.accountUrl) header.jwk = this.jwk;
    else header.kid = this.accountUrl;
    const protectedB64 = b64u(JSON.stringify(header));
    const payloadB64 = payload === null ? "" : b64u(JSON.stringify(payload));
    const signature = sign(
      "sha256",
      Buffer.from(`${protectedB64}.${payloadB64}`),
      {
        key: this.key.privateKey,
        dsaEncoding: "ieee-p1363",
      },
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/jose+json" },
      body: JSON.stringify({
        protected: protectedB64,
        payload: payloadB64,
        signature: b64u(signature),
      }),
    });
    const n = res.headers.get("replay-nonce");
    if (n) this.nonce = n;
    if (res.status === 400 && !retried) {
      const body = (await res
        .clone()
        .json()
        .catch(() => ({}))) as { type?: string };
      if (body.type === "urn:ietf:params:acme:error:badNonce")
        return this.post(url, payload, useJwk, true);
    }
    return res;
  }

  private async expectJson<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `ACME ${what}: HTTP ${res.status} ${detail.slice(0, 500)}`,
      );
    }
    return (await res.json()) as T;
  }

  async ensureAccount(): Promise<string> {
    if (this.accountUrl) return this.accountUrl;
    const res = await this.post(
      (await this.directory()).newAccount,
      {
        termsOfServiceAgreed: true,
        ...(this.opts.contact?.length ? { contact: this.opts.contact } : {}),
      },
      true,
    );
    await this.expectJson(res, "newAccount");
    const url = res.headers.get("location");
    if (!url) throw new Error("ACME newAccount: no Location");
    this.accountUrl = url;
    return url;
  }

  private async poll<T extends { status: string }>(
    url: string,
    done: (t: T) => boolean,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + (this.opts.timeoutMs ?? 120_000);
    for (;;) {
      const t = await this.expectJson<T>(await this.post(url, null), what);
      if (t.status === "invalid")
        throw new Error(
          `ACME ${what} is invalid: ${JSON.stringify(t).slice(0, 500)}`,
        );
      if (done(t)) return t;
      if (Date.now() > deadline) throw new Error(`ACME ${what}: timed out`);
      await new Promise((r) => setTimeout(r, this.opts.pollIntervalMs ?? 1000));
    }
  }

  async obtainCertificate(input: {
    identifiers: string[];
    responder: ChallengeResponder;
    profile?: string | null;
    prefer?: "http-01" | "tls-alpn-01";
  }): Promise<IssuedCertificate> {
    const log = this.opts.log;
    const accountUrl = await this.ensureAccount();
    const orderRes = await this.post((await this.directory()).newOrder, {
      identifiers: input.identifiers.map((value) => ({
        type: isIP(value) ? "ip" : "dns",
        value,
      })),
      ...(input.profile ? { profile: input.profile } : {}),
    });
    let order = await this.expectJson<Order>(orderRes, "newOrder");
    const orderUrl = orderRes.headers.get("location");
    if (!orderUrl) throw new Error("ACME newOrder: no Location");

    const cleanups: (() => void)[] = [];
    try {
      for (const authzUrl of order.authorizations) {
        const authz = await this.expectJson<Authorization>(
          await this.post(authzUrl, null),
          "authorization",
        );
        if (authz.status === "valid") continue;
        const types =
          input.prefer === "tls-alpn-01"
            ? ["tls-alpn-01", "http-01"]
            : ["http-01", "tls-alpn-01"];
        const challenge = types
          .filter((t) =>
            t === "http-01"
              ? input.responder.http01
              : input.responder.tlsAlpn01,
          )
          .map((t) => authz.challenges.find((c) => c.type === t))
          .find(Boolean);
        if (!challenge)
          throw new Error(
            `ACME: no usable challenge for ${authz.identifier.value}`,
          );
        const keyAuth = this.keyAuthorization(challenge.token);
        if (challenge.type === "http-01") {
          input.responder.http01!.set(challenge.token, keyAuth);
          cleanups.push(() => input.responder.http01!.remove(challenge.token));
        } else {
          const servername = alpnServername(authz.identifier.value);
          const k = generateP256();
          const cert = toPem(
            buildCertificate({
              identifiers: [authz.identifier.value],
              publicKey: k.publicKey,
              issuerKey: k.privateKey,
              notBefore: new Date(Date.now() - 3600_000),
              notAfter: new Date(Date.now() + 7 * 86400_000),
              acmeIdentifier: new Uint8Array(
                createHash("sha256").update(keyAuth).digest(),
              ),
            }),
          );
          input.responder.tlsAlpn01!.set(servername, cert, k.keyPem);
          cleanups.push(() => input.responder.tlsAlpn01!.remove(servername));
        }
        log?.info(`ACME: ${challenge.type} for ${authz.identifier.value}`);
        await this.expectJson(await this.post(challenge.url, {}), "challenge");
        await this.poll<Authorization>(
          authzUrl,
          (a) => a.status === "valid",
          "authorization",
        );
      }

      const certKey = generateP256();
      const csr = buildCsr(input.identifiers, certKey);
      order = await this.expectJson<Order>(
        await this.post(order.finalize, { csr: b64u(csr) }),
        "finalize",
      );
      order = await this.poll<Order>(
        orderUrl,
        (o) => o.status === "valid" && Boolean(o.certificate),
        "order",
      );
      const certRes = await this.post(order.certificate!, null);
      if (!certRes.ok)
        throw new Error(`ACME certificate: HTTP ${certRes.status}`);
      const certPem = await certRes.text();
      const { X509Certificate } = await import("node:crypto");
      const notAfter = new Date(new X509Certificate(certPem).validTo);
      return { certPem, keyPem: certKey.keyPem, notAfter, accountUrl };
    } finally {
      for (const c of cleanups) c();
    }
  }
}
