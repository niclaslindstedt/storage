// A small but honest ACME CA for tests: it checks JWS signatures and nonces,
// really validates http-01 (fetching the token from the client) and
// tls-alpn-01 (a TLS handshake with ALPN acme-tls/1, checking the
// acmeIdentifier extension), and issues certificates from a test CA.

import {
  createHash,
  createPublicKey,
  verify,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect } from "node:tls";
import type { AddressInfo } from "node:net";

import * as A from "../src/tls/asn1.ts";
import { alpnServername } from "../src/tls/acme.ts";
import { buildCertificate, generateP256, toPem } from "../src/tls/x509.ts";

type Authz = {
  id: number;
  identifier: { type: string; value: string };
  status: string;
  token: string;
  orderId: number;
};
type Order = {
  id: number;
  status: string;
  identifiers: { type: string; value: string }[];
  authz: number[];
  certificate?: string;
  profile?: string;
};

export type FakeAcme = {
  url: string;
  caPem: string;
  requests: string[];
  orders: Order[];
  close(): Promise<void>;
};

export async function startFakeAcme(opts: {
  httpPort: () => number;
  tlsPort: () => number;
  lifetimeDays?: number;
}): Promise<FakeAcme> {
  const ca = generateP256();
  const caPem = toPem(
    buildCertificate({
      identifiers: [],
      issuerName: "Fake ACME CA",
      publicKey: ca.publicKey,
      issuerKey: ca.privateKey,
      notBefore: new Date(Date.now() - 3600_000),
      notAfter: new Date(Date.now() + 30 * 86400_000),
      ca: true,
    }),
  );
  const nonces = new Set<string>();
  const accounts = new Map<string, KeyObject>();
  const authzs: Authz[] = [];
  const orders: Order[] = [];
  const certs = new Map<string, string>();
  const requests: string[] = [];
  let seq = 0;
  let base = "";

  const newNonce = () => {
    const n = `n${++seq}${Math.random().toString(36).slice(2)}`;
    nonces.add(n);
    return n;
  };

  function thumbprint(key: KeyObject): string {
    const j = key.export({ format: "jwk" }) as Record<string, string>;
    return createHash("sha256")
      .update(JSON.stringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y }))
      .digest("base64url");
  }

  async function validate(
    a: Authz,
    type: string,
    key: KeyObject,
  ): Promise<boolean> {
    const keyAuth = `${a.token}.${thumbprint(key)}`;
    if (type === "http-01") {
      const res = await fetch(
        `http://127.0.0.1:${opts.httpPort()}/.well-known/acme-challenge/${a.token}`,
      );
      return res.ok && (await res.text()).trim() === keyAuth;
    }
    const der = await new Promise<Buffer>((resolve, reject) => {
      const s = connect(
        {
          host: "127.0.0.1",
          port: opts.tlsPort(),
          servername: alpnServername(a.identifier.value),
          ALPNProtocols: ["acme-tls/1"],
          rejectUnauthorized: false,
        },
        () => {
          if (s.alpnProtocol !== "acme-tls/1")
            reject(new Error(`alpn ${s.alpnProtocol}`));
          resolve(s.getPeerCertificate(true).raw);
          s.end();
        },
      );
      s.on("error", reject);
    });
    const expected = createHash("sha256").update(keyAuth).digest();
    // Find the acmeIdentifier extension (OID 1.3.6.1.5.5.7.1.31) and compare.
    const oid = Buffer.from(A.oid("1.3.6.1.5.5.7.1.31"));
    const at = der.indexOf(oid);
    if (at < 0) return false;
    return der.subarray(at).includes(expected);
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    requests.push(`${req.method} ${url.pathname}`);
    res.setHeader("Replay-Nonce", newNonce());
    if (url.pathname === "/dir") {
      res.end(
        JSON.stringify({
          newNonce: `${base}/nonce`,
          newAccount: `${base}/acct`,
          newOrder: `${base}/order`,
        }),
      );
      return;
    }
    if (url.pathname === "/nonce") {
      res.writeHead(200).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const jws = JSON.parse(Buffer.concat(chunks).toString());
    const header = JSON.parse(
      Buffer.from(jws.protected, "base64url").toString(),
    );
    if (!nonces.delete(header.nonce)) {
      res.writeHead(400, { "Content-Type": "application/problem+json" });
      res.end(JSON.stringify({ type: "urn:ietf:params:acme:error:badNonce" }));
      return;
    }
    if (header.url !== `${base}${url.pathname}`) {
      res.writeHead(400).end("url mismatch");
      return;
    }
    const key = header.jwk
      ? createPublicKey({ key: header.jwk, format: "jwk" })
      : accounts.get(header.kid);
    if (
      !key ||
      !verify(
        "sha256",
        Buffer.from(`${jws.protected}.${jws.payload}`),
        { key, dsaEncoding: "ieee-p1363" },
        Buffer.from(jws.signature, "base64url"),
      )
    ) {
      res.writeHead(401).end("bad signature");
      return;
    }
    const payload = jws.payload
      ? JSON.parse(Buffer.from(jws.payload, "base64url").toString())
      : null;
    const json = (
      status: number,
      body: unknown,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "acct") {
      const acct = `${base}/acct/${accounts.size + 1}`;
      accounts.set(acct, key);
      return json(201, { status: "valid" }, { Location: acct });
    }
    const accountKey = accounts.get(header.kid)!;
    if (parts[0] === "order" && parts.length === 1) {
      const o: Order = {
        id: orders.length + 1,
        status: "pending",
        identifiers: payload.identifiers,
        authz: [],
        profile: payload.profile,
      };
      for (const identifier of payload.identifiers) {
        const a: Authz = {
          id: authzs.length + 1,
          identifier,
          status: "pending",
          token: `tok${authzs.length + 1}${seq}`,
          orderId: o.id,
        };
        authzs.push(a);
        o.authz.push(a.id);
      }
      orders.push(o);
      return json(201, orderBody(o), { Location: `${base}/order/${o.id}` });
    }
    if (parts[0] === "order" && parts[2] === "finalize") {
      const o = orders[Number(parts[1]) - 1]!;
      if (o.authz.some((id) => authzs[id - 1]!.status !== "valid"))
        return json(403, { type: "orderNotReady" });
      const csr = new Uint8Array(Buffer.from(payload.csr, "base64url"));
      const root = A.read(csr);
      const info = A.children(csr, root)[0]!;
      const spkiNode = A.children(csr, info)[2]!;
      const leafKey = createPublicKey({
        key: Buffer.from(spkiNode.bytes),
        format: "der",
        type: "spki",
      });
      const days = opts.lifetimeDays ?? 90;
      const leaf = toPem(
        buildCertificate({
          identifiers: o.identifiers.map((i) => i.value),
          issuerName: "Fake ACME CA",
          publicKey: leafKey,
          issuerKey: ca.privateKey,
          notBefore: new Date(Date.now() - 60_000),
          notAfter: new Date(Date.now() + days * 86400_000),
        }),
      );
      certs.set(String(o.id), leaf + caPem);
      o.status = "valid";
      o.certificate = `${base}/cert/${o.id}`;
      return json(200, orderBody(o));
    }
    if (parts[0] === "order")
      return json(200, orderBody(orders[Number(parts[1]) - 1]!));
    if (parts[0] === "authz") {
      const a = authzs[Number(parts[1]) - 1]!;
      return json(200, {
        status: a.status,
        identifier: a.identifier,
        challenges: ["http-01", "tls-alpn-01"].map((type) => ({
          type,
          url: `${base}/chall/${a.id}/${type}`,
          token: a.token,
          status: a.status,
        })),
      });
    }
    if (parts[0] === "chall") {
      const a = authzs[Number(parts[1]) - 1]!;
      const ok = await validate(a, parts[2]!, accountKey).catch(() => false);
      a.status = ok ? "valid" : "invalid";
      return json(200, { status: a.status });
    }
    if (parts[0] === "cert") {
      res.writeHead(200, {
        "Content-Type": "application/pem-certificate-chain",
      });
      res.end(certs.get(parts[1]!));
      return;
    }
    res.writeHead(404).end();
  });

  function orderBody(o: Order) {
    return {
      status: o.status,
      identifiers: o.identifiers,
      authorizations: o.authz.map((id) => `${base}/authz/${id}`),
      finalize: `${base}/order/${o.id}/finalize`,
      ...(o.certificate ? { certificate: o.certificate } : {}),
    };
  }

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  void X509Certificate;
  return {
    url: `${base}/dir`,
    caPem,
    requests,
    orders,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
