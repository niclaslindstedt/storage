// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Certificates for the HTTPS listener (SPEC §10), in one of four modes:
//   acme        — Let's Encrypt (or any ACME CA) for DNS names or public IPs,
//                 renewed at a third of the remaining lifetime, hot-swapped.
//   files       — PEM files you manage; reloaded when they change.
//   self-signed — generated and kept in the data dir; the QR carries its
//                 key fingerprint so native wrappers can pin it.
//   off         — no TLS here (a reverse proxy or tunnel terminates it).

import { X509Certificate, createPublicKey } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { join } from "node:path";
import { createSecureContext, type SecureContext } from "node:tls";

import type { ServerConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import type { Clock } from "../util/clock.ts";
import { AcmeClient, type ChallengeResponder, type FetchImpl } from "./acme.ts";
import { generateP256, selfSigned, spkiFingerprint } from "./x509.ts";

type CertState = {
  keyPem: string;
  certPem: string;
  fp: string;
  notBefore: number;
  notAfter: number;
};

export type TlsManagerOptions = {
  config: ServerConfig;
  log: Logger;
  clock: Clock;
  fetchImpl?: FetchImpl;
  /** Extra names for a self-signed certificate (LAN addresses …). */
  extraNames?: string[];
};

export class TlsManager {
  private state: CertState | null = null;
  private context: SecureContext | null = null;
  private readonly tokens = new Map<string, string>();
  private readonly alpn = new Map<string, SecureContext>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly dir: string | null;

  constructor(private readonly opts: TlsManagerOptions) {
    this.dir = opts.config.dataDir ? join(opts.config.dataDir, "tls") : null;
  }

  get mode(): ServerConfig["tls"]["mode"] {
    return this.opts.config.tls.mode;
  }

  /** Load or obtain the certificate for the configured mode. */
  async start(): Promise<void> {
    if (this.dir) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    switch (this.mode) {
      case "off":
        return;
      case "files":
        this.loadFiles();
        this.watchFiles();
        return;
      case "self-signed":
        this.loadOrCreateSelfSigned();
        return;
      case "acme":
        this.loadPersisted();
        if (!this.state || this.needsRenewal()) await this.renew();
        this.timer = setInterval(() => void this.renewIfDue(), 3600_000);
        this.timer.unref();
        return;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    const { certFile, keyFile } = this.opts.config.tls;
    if (this.mode === "files" && certFile && keyFile) {
      unwatchFile(certFile);
      unwatchFile(keyFile);
    }
  }

  onUpdate(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** PEM key + chain for `https.createServer`. */
  credentials(): { key: string; cert: string } | null {
    return this.state
      ? { key: this.state.keyPem, cert: this.state.certPem }
      : null;
  }

  secureContext(): SecureContext | null {
    return this.context;
  }

  info(): { mode: string; fp?: string; notAfter?: number } {
    return {
      mode: this.mode,
      ...(this.state
        ? { fp: this.state.fp, notAfter: this.state.notAfter }
        : {}),
    };
  }

  /** SNI callback: tls-alpn-01 validation contexts first, else the server cert. */
  readonly sniCallback = (
    servername: string,
    cb: (err: Error | null, ctx?: SecureContext) => void,
  ): void => {
    cb(
      null,
      this.alpn.get(servername.toLowerCase()) ?? this.context ?? undefined,
    );
  };

  /** Serve an http-01 token; returns true when it handled the request. */
  handleHttp01(req: IncomingMessage, res: ServerResponse): boolean {
    const m = req.url?.match(
      /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/,
    );
    if (!m) return false;
    const value = this.tokens.get(m[1]!);
    if (!value) {
      res.writeHead(404).end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/plain" }).end(value);
    return true;
  }

  needsRenewal(): boolean {
    if (!this.state) return true;
    const now = this.opts.clock.now();
    const lifetime = this.state.notAfter - this.state.notBefore;
    return this.state.notAfter - now < lifetime / 3;
  }

  private async renewIfDue(): Promise<void> {
    if (!this.needsRenewal()) return;
    try {
      await this.renew();
    } catch (err) {
      this.opts.log.error("certificate renewal failed; will retry", err);
    }
  }

  private responder(): ChallengeResponder {
    return {
      http01: {
        set: (t, k) => this.tokens.set(t, k),
        remove: (t) => this.tokens.delete(t),
      },
      tlsAlpn01: {
        set: (name, cert, key) =>
          this.alpn.set(name.toLowerCase(), createSecureContext({ cert, key })),
        remove: (name) => this.alpn.delete(name.toLowerCase()),
      },
    };
  }

  /** Obtain a fresh certificate from the ACME CA and swap it in. */
  async renew(): Promise<void> {
    const cfg = this.opts.config.tls;
    if (cfg.domains.length === 0)
      throw new Error(
        "tls.domains is empty: name the DNS names or public IP to certify",
      );
    const accountKeyPem = this.readOr(
      "acme-account.key",
      () => generateP256().keyPem,
    );
    const accountUrl =
      this.readJson<{ url: string }>("acme-account.json")?.url ?? null;
    const hasIp = cfg.domains.some((d) => isIP(d) !== 0);
    const client = new AcmeClient({
      directoryUrl: cfg.acmeDirectory,
      accountKeyPem,
      accountUrl,
      contact: cfg.acmeEmail ? [`mailto:${cfg.acmeEmail}`] : undefined,
      fetchImpl: this.opts.fetchImpl,
      log: this.opts.log,
    });
    this.opts.log.info(
      `requesting a certificate for ${cfg.domains.join(", ")}`,
    );
    const issued = await client.obtainCertificate({
      identifiers: cfg.domains,
      responder: this.responder(),
      profile: cfg.acmeProfile ?? (hasIp ? "shortlived" : null),
      prefer: this.opts.config.listen.httpPort ? "http-01" : "tls-alpn-01",
    });
    this.write("acme-account.json", JSON.stringify({ url: issued.accountUrl }));
    this.install(issued.keyPem, issued.certPem);
    this.persist();
    this.opts.log.status(
      `certificate valid until ${new Date(this.state!.notAfter).toISOString()}`,
    );
  }

  private install(keyPem: string, certPem: string): void {
    const cert = new X509Certificate(certPem);
    this.state = {
      keyPem,
      certPem,
      fp: spkiFingerprint(createPublicKey(keyPem)),
      notBefore: Date.parse(cert.validFrom),
      notAfter: Date.parse(cert.validTo),
    };
    this.context = createSecureContext({ key: keyPem, cert: certPem });
    for (const fn of this.listeners) fn();
  }

  private persist(): void {
    if (!this.state) return;
    this.write("key.pem", this.state.keyPem);
    this.write("cert.pem", this.state.certPem);
  }

  private loadPersisted(): void {
    const key = this.read("key.pem");
    const cert = this.read("cert.pem");
    if (key && cert) {
      try {
        this.install(key, cert);
      } catch (err) {
        this.opts.log.warn(
          "stored certificate is unreadable; obtaining a new one",
          err,
        );
      }
    }
  }

  private loadOrCreateSelfSigned(): void {
    const key = this.read("self-signed.key");
    const cert = this.read("self-signed.crt");
    if (key && cert) {
      this.install(key, cert);
      if (!this.needsRenewal()) return;
    }
    const names = [
      ...new Set([
        ...this.opts.config.tls.domains,
        ...(this.opts.extraNames ?? []),
        "localhost",
        "127.0.0.1",
      ]),
    ];
    const k = generateP256();
    const pem = selfSigned(names, k, new Date(this.opts.clock.now()));
    this.install(k.keyPem, pem);
    this.write("self-signed.key", k.keyPem);
    this.write("self-signed.crt", pem);
    this.opts.log.info(
      `generated a self-signed certificate for ${names.join(", ")}`,
    );
  }

  private loadFiles(): void {
    const { certFile, keyFile } = this.opts.config.tls;
    if (!certFile || !keyFile)
      throw new Error("tls.mode=files needs tls.certFile and tls.keyFile");
    this.install(readFileSync(keyFile, "utf8"), readFileSync(certFile, "utf8"));
  }

  private watchFiles(): void {
    const { certFile, keyFile } = this.opts.config.tls;
    const reload = () => {
      try {
        this.loadFiles();
        this.opts.log.info("reloaded TLS certificate from files");
      } catch (err) {
        this.opts.log.warn("could not reload TLS certificate files", err);
      }
    };
    watchFile(certFile!, { interval: 5000 }, reload);
    watchFile(keyFile!, { interval: 5000 }, reload);
  }

  // ---- small persistence helpers (data dir, or memory when there is none) ----

  private readonly memory = new Map<string, string>();

  private read(name: string): string | null {
    if (!this.dir) return this.memory.get(name) ?? null;
    const p = join(this.dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  private readOr(name: string, make: () => string): string {
    const v = this.read(name);
    if (v) return v;
    const made = make();
    this.write(name, made);
    return made;
  }

  private readJson<T>(name: string): T | null {
    const v = this.read(name);
    try {
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }

  private write(name: string, value: string): void {
    if (!this.dir) {
      this.memory.set(name, value);
      return;
    }
    writeFileSync(join(this.dir, name), value, { mode: 0o600 });
  }
}
