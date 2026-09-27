// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Read the certificate a configuration serves and describe it — for
// `cert status`, `doctor` and the admin console.

import { X509Certificate, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ServerConfig } from "../config.ts";

export type CertificateInfo = {
  names: string;
  notAfter: string;
  /** SHA-256 of the SubjectPublicKeyInfo, base64url (what QR codes pin). */
  fp: string;
  /** Whole days left (negative once expired). */
  days: number;
};

/** The PEM certificate on disk for this configuration, if any. */
export function readCertificatePem(config: ServerConfig): string | null {
  if (!config.dataDir && config.tls.mode !== "files") return null;
  const tlsDir = join(config.dataDir ?? ".", "tls");
  const file =
    config.tls.mode === "files"
      ? config.tls.certFile
      : config.tls.mode === "acme"
        ? join(tlsDir, "cert.pem")
        : config.tls.mode === "self-signed"
          ? join(tlsDir, "self-signed.crt")
          : null;
  return file && existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function describeCertificate(
  pem: string,
  now = Date.now(),
): CertificateInfo {
  const cert = new X509Certificate(pem);
  const fp = createHash("sha256")
    .update(cert.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const notAfter = Date.parse(cert.validTo);
  return {
    names: cert.subjectAltName ?? cert.subject,
    notAfter: new Date(notAfter).toISOString(),
    fp,
    days: Math.floor((notAfter - now) / 86400_000),
  };
}
