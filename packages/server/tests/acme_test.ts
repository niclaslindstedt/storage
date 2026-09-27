import { X509Certificate } from "node:crypto";
import { createServer as createHttp, type Server } from "node:http";
import {
  createServer as createTls,
  createSecureContext,
  type Server as TlsServer,
  type SecureContext,
} from "node:tls";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  AcmeClient,
  alpnServername,
  type ChallengeResponder,
} from "../src/tls/acme.ts";
import { generateP256, selfSigned } from "../src/tls/x509.ts";
import { startFakeAcme, type FakeAcme } from "./fake-acme.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function responders() {
  const tokens = new Map<string, string>();
  const http: Server = createHttp((req, res) => {
    const m = req.url?.match(/^\/\.well-known\/acme-challenge\/([\w-]+)$/);
    const v = m ? tokens.get(m[1]!) : undefined;
    if (!v) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/plain" }).end(v);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise((r) => http.close(() => r())));

  const alpn = new Map<string, SecureContext>();
  const fallbackKey = generateP256();
  const tls: TlsServer = createTls(
    {
      key: fallbackKey.keyPem,
      cert: selfSigned(["localhost"], fallbackKey, new Date()),
      ALPNProtocols: ["acme-tls/1", "http/1.1"],
      SNICallback: (name, cb) => cb(null, alpn.get(name) ?? undefined),
    },
    (s) => s.end(),
  );
  await new Promise<void>((r) => tls.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise((r) => tls.close(() => r())));

  const responder: ChallengeResponder = {
    http01: {
      set: (t, k) => tokens.set(t, k),
      remove: (t) => tokens.delete(t),
    },
    tlsAlpn01: {
      set: (name, cert, key) =>
        alpn.set(name, createSecureContext({ cert, key })),
      remove: (name) => alpn.delete(name),
    },
  };
  return {
    responder,
    httpPort: () => (http.address() as AddressInfo).port,
    tlsPort: () => (tls.address() as AddressInfo).port,
  };
}

async function setup() {
  const r = await responders();
  const ca: FakeAcme = await startFakeAcme({
    httpPort: r.httpPort,
    tlsPort: r.tlsPort,
    lifetimeDays: 6,
  });
  cleanups.push(() => ca.close());
  return { ...r, ca };
}

describe("ACME client", () => {
  it("maps IP identifiers to their reverse-DNS SNI", () => {
    expect(alpnServername("203.0.113.7")).toBe("7.113.0.203.in-addr.arpa");
    expect(alpnServername("example.org")).toBe("example.org");
    expect(alpnServername("2001:db8::1")).toMatch(
      /^1\.0\.0\.0\..*\.8\.b\.d\.0\.1\.0\.0\.2\.ip6\.arpa$/,
    );
  });

  it("obtains a certificate for a DNS name via http-01", async () => {
    const { responder, ca } = await setup();
    const client = new AcmeClient({
      directoryUrl: ca.url,
      accountKeyPem: generateP256().keyPem,
      pollIntervalMs: 10,
    });
    const out = await client.obtainCertificate({
      identifiers: ["storage.example"],
      responder,
      prefer: "http-01",
    });
    const leaf = new X509Certificate(out.certPem);
    expect(leaf.subjectAltName).toContain("DNS:storage.example");
    expect(leaf.verify(new X509Certificate(ca.caPem).publicKey)).toBe(true);
    expect(out.notAfter.getTime() - Date.now()).toBeGreaterThan(5 * 86400_000);
    expect(ca.requests.some((r) => r.includes("/chall/1/http-01"))).toBe(true);
  });

  it("obtains a short-lived IP certificate via tls-alpn-01 and reuses the account", async () => {
    const { responder, ca } = await setup();
    const accountKeyPem = generateP256().keyPem;
    const client = new AcmeClient({
      directoryUrl: ca.url,
      accountKeyPem,
      pollIntervalMs: 10,
    });
    const out = await client.obtainCertificate({
      identifiers: ["127.0.0.1"],
      responder,
      prefer: "tls-alpn-01",
      profile: "shortlived",
    });
    expect(new X509Certificate(out.certPem).subjectAltName).toContain(
      "IP Address:127.0.0.1",
    );
    expect(ca.orders[0]!.profile).toBe("shortlived");
    const again = new AcmeClient({
      directoryUrl: ca.url,
      accountKeyPem,
      accountUrl: out.accountUrl,
      pollIntervalMs: 10,
    });
    await again.obtainCertificate({ identifiers: ["127.0.0.1"], responder });
    expect(ca.requests.filter((r) => r === "POST /acct")).toHaveLength(1);
  });

  it("fails clearly when the challenge cannot be validated", async () => {
    const { ca } = await setup();
    const client = new AcmeClient({
      directoryUrl: ca.url,
      accountKeyPem: generateP256().keyPem,
      pollIntervalMs: 10,
    });
    const broken: ChallengeResponder = { http01: { set() {}, remove() {} } };
    await expect(
      client.obtainCertificate({
        identifiers: ["x.example"],
        responder: broken,
      }),
    ).rejects.toThrow(/invalid/);
  });
});
