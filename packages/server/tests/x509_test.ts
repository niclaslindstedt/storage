import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createTls, connect } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import * as A from "../src/tls/asn1.ts";
import {
  buildCertificate,
  buildCsr,
  fromPem,
  generateP256,
  selfSigned,
  spkiFingerprint,
  toPem,
} from "../src/tls/x509.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
}

describe("ASN.1", () => {
  it("encodes lengths, integers and OIDs per DER", () => {
    expect([...A.int(0)]).toEqual([0x02, 0x01, 0x00]);
    expect([...A.int(128)]).toEqual([0x02, 0x02, 0x00, 0x80]);
    expect([...A.oid("1.2.840.10045.4.3.2")]).toEqual([
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
    ]);
    const long = A.octets(new Uint8Array(300));
    expect([...long.slice(0, 4)]).toEqual([0x04, 0x82, 0x01, 0x2c]);
    const node = A.read(long);
    expect(node.end - node.start).toBe(300);
  });
});

describe("X.509", () => {
  it("builds a self-signed certificate Node accepts, with DNS and IP SANs", () => {
    const key = generateP256();
    const pem = selfSigned(
      ["storage.example", "127.0.0.1", "::1"],
      key,
      new Date(),
    );
    const cert = new X509Certificate(pem);
    expect(cert.subjectAltName).toContain("DNS:storage.example");
    expect(cert.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(cert.checkHost("storage.example")).toBe("storage.example");
    expect(cert.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(cert.verify(key.publicKey)).toBe(true);
    expect(spkiFingerprint(key.publicKey)).toBe(
      createHash("sha256")
        .update(cert.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64url"),
    );
  });

  it("serves TLS with the generated certificate", async () => {
    const key = generateP256();
    const pem = selfSigned(["localhost", "127.0.0.1"], key, new Date());
    const server = createTls({ key: key.keyPem, cert: pem }, (s) =>
      s.end("ok"),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const text = await new Promise<string>((resolve, reject) => {
      const s = connect(
        { port, host: "127.0.0.1", ca: pem, servername: "localhost" },
        () => {
          s.setEncoding("utf8");
          let out = "";
          s.on("data", (d) => (out += d));
          s.on("end", () => resolve(out));
        },
      );
      s.on("error", reject);
    });
    server.close();
    expect(text).toBe("ok");
  });

  it("builds a CA and a leaf chain that verifies", () => {
    const caKey = generateP256();
    const ca = toPem(
      buildCertificate({
        identifiers: [],
        issuerName: "Test CA",
        publicKey: caKey.publicKey,
        issuerKey: caKey.privateKey,
        notBefore: new Date(Date.now() - 1000),
        notAfter: new Date(Date.now() + 86400_000),
        ca: true,
      }),
    );
    const leafKey = generateP256();
    const leaf = toPem(
      buildCertificate({
        identifiers: ["a.example"],
        issuerName: "Test CA",
        publicKey: leafKey.publicKey,
        issuerKey: caKey.privateKey,
        notBefore: new Date(Date.now() - 1000),
        notAfter: new Date(Date.now() + 86400_000),
      }),
    );
    expect(
      new X509Certificate(leaf).verify(new X509Certificate(ca).publicKey),
    ).toBe(true);
    expect(new X509Certificate(ca).ca).toBe(true);
    expect(fromPem(leaf + ca)).toHaveLength(2);
  });

  it.skipIf(!hasOpenssl())("produces a CSR openssl verifies", () => {
    const dir = mkdtempSync(join(tmpdir(), "csr-"));
    dirs.push(dir);
    const key = generateP256();
    const csr = toPem(
      buildCsr(["storage.example", "203.0.113.7"], key),
      "CERTIFICATE REQUEST",
    );
    writeFileSync(join(dir, "req.pem"), csr);
    const out = execFileSync(
      "openssl",
      ["req", "-in", join(dir, "req.pem"), "-noout", "-verify", "-text"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(out).toContain("DNS:storage.example");
    expect(out).toContain("IP Address:203.0.113.7");
  });
});
