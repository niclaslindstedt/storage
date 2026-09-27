// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Build P-256 X.509 certificates and PKCS#10 certificate requests: the
// self-signed fallback certificate, the CSR an ACME order is finalised
// with, and the special tls-alpn-01 validation certificate (RFC 8737).

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import { isIP } from "node:net";

import * as A from "./asn1.ts";

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
  extensionRequest: "1.2.840.113549.1.9.14",
  acmeIdentifier: "1.3.6.1.5.5.7.1.31",
};

export type KeyPairPem = {
  keyPem: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
};

export function generateP256(): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    privateKey,
    publicKey,
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function loadKey(pem: string): {
  privateKey: KeyObject;
  publicKey: KeyObject;
} {
  const privateKey = createPrivateKey(pem);
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

function spki(publicKey: KeyObject): Uint8Array {
  return new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
}

/** SHA-256 of the SubjectPublicKeyInfo, base64url — the pin a QR carries. */
export function spkiFingerprint(publicKey: KeyObject): string {
  return createHash("sha256").update(spki(publicKey)).digest("base64url");
}

function name(cn: string): A.Der {
  return A.seq(A.set(A.seq(A.oid(OID.commonName), A.utf8(cn))));
}

function ipBytes(ip: string): Uint8Array {
  if (isIP(ip) === 4) return Uint8Array.from(ip.split(".").map(Number));
  // IPv6: expand "::" and pack 8 groups.
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = [...h, ...new Array(8 - h.length - t.length).fill("0"), ...t];
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g, 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

function sanExtension(identifiers: readonly string[]): A.Der {
  const names = identifiers.map((id) =>
    isIP(id)
      ? A.implicit(7, ipBytes(id))
      : A.implicit(2, new TextEncoder().encode(id)),
  );
  return A.seq(A.oid(OID.subjectAltName), A.octets(A.seq(...names)));
}

const ALG = () => A.seq(A.oid(OID.ecdsaWithSha256));

function signDer(tbs: Uint8Array, privateKey: KeyObject): Uint8Array {
  return new Uint8Array(
    sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" }),
  );
}

export type CertificateOptions = {
  identifiers: readonly string[];
  publicKey: KeyObject;
  /** Signing key; the subject's own for self-signed. */
  issuerKey: KeyObject;
  issuerName?: string;
  notBefore: Date;
  notAfter: Date;
  ca?: boolean;
  /** tls-alpn-01: SHA-256 of the key authorization. */
  acmeIdentifier?: Uint8Array;
};

export function buildCertificate(o: CertificateOptions): Uint8Array {
  const cn = o.identifiers[0] ?? "storage";
  const exts: A.Der[] = [];
  if (o.identifiers.length > 0) exts.push(sanExtension(o.identifiers));
  exts.push(
    A.seq(
      A.oid(OID.basicConstraints),
      A.bool(true),
      A.octets(A.seq(...(o.ca ? [A.bool(true)] : []))),
    ),
  );
  // keyUsage: digitalSignature (bit 0), plus keyCertSign (bit 5) for a CA.
  const ku = o.ca ? Uint8Array.of(0x02, 0x84) : Uint8Array.of(0x07, 0x80);
  exts.push(
    A.seq(A.oid(OID.keyUsage), A.bool(true), A.octets(A.tlv(0x03, ku))),
  );
  if (!o.ca)
    exts.push(
      A.seq(A.oid(OID.extKeyUsage), A.octets(A.seq(A.oid(OID.serverAuth)))),
    );
  if (o.acmeIdentifier) {
    exts.push(
      A.seq(
        A.oid(OID.acmeIdentifier),
        A.bool(true),
        A.octets(A.octets(o.acmeIdentifier)),
      ),
    );
  }
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const tbs = A.seq(
    A.explicit(0, A.int(2)),
    A.uint(serial),
    ALG(),
    name(o.issuerName ?? cn),
    A.seq(A.time(o.notBefore), A.time(o.notAfter)),
    name(cn),
    spki(o.publicKey),
    A.explicit(3, A.seq(...exts)),
  );
  return A.seq(tbs, ALG(), A.bits(signDer(tbs, o.issuerKey)));
}

/** A PKCS#10 request for `identifiers` (first one is the subject CN). */
export function buildCsr(
  identifiers: readonly string[],
  key: { publicKey: KeyObject; privateKey: KeyObject },
): Uint8Array {
  const info = A.seq(
    A.int(0),
    name(identifiers[0]!),
    spki(key.publicKey),
    A.explicit(
      0,
      A.seq(
        A.oid(OID.extensionRequest),
        A.set(A.seq(sanExtension(identifiers))),
      ),
    ),
  );
  return A.seq(info, ALG(), A.bits(signDer(info, key.privateKey)));
}

export function toPem(der: Uint8Array, label = "CERTIFICATE"): string {
  const b64 = Buffer.from(der).toString("base64").replace(/.{64}/g, "$&\n");
  return `-----BEGIN ${label}-----\n${b64}${b64.endsWith("\n") ? "" : "\n"}-----END ${label}-----\n`;
}

/** Split a PEM bundle into DER blocks of the given label. */
export function fromPem(pem: string, label = "CERTIFICATE"): Uint8Array[] {
  const re = new RegExp(
    `-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`,
    "g",
  );
  return [...pem.matchAll(re)].map(
    (m) => new Uint8Array(Buffer.from(m[1]!.replace(/\s+/g, ""), "base64")),
  );
}

/** A self-signed server certificate valid for `days`. */
export function selfSigned(
  identifiers: readonly string[],
  key: KeyPairPem,
  now: Date,
  days = 397,
): string {
  return toPem(
    buildCertificate({
      identifiers,
      publicKey: key.publicKey,
      issuerKey: key.privateKey,
      notBefore: new Date(now.getTime() - 3600_000),
      notAfter: new Date(now.getTime() + days * 86400_000),
    }),
  );
}
