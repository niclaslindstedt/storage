// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Keep the server's ports forwarded on a home router: try UPnP IGD first,
// NAT-PMP second; renew at half the lease; remove mappings on shutdown; and
// explain (rather than silently fail) when the router's WAN side is itself
// behind NAT.

import type { Logger } from "../log.ts";
import type { FetchImpl } from "../tls/acme.ts";
import { natPmpExternalIp, natPmpMapTcp, NATPMP_PORT } from "./natpmp.ts";
import {
  defaultGateway,
  localAddressFor,
  unreachableReason,
} from "./netinfo.ts";
import { type DiscoverOptions, discoverGateway, UpnpClient } from "./upnp.ts";

export type PortSpec = { internal: number; external: number };

export type PortMapStatus = {
  method: "upnp" | "natpmp" | null;
  externalIp: string | null;
  mapped: PortSpec[];
  warning: string | null;
  error: string | null;
};

export type PortMapperOptions = {
  log: Logger;
  leaseSeconds: number;
  description?: string;
  discover?: DiscoverOptions;
  fetchImpl?: FetchImpl;
  /** Override the gateway address for NAT-PMP (and the port, for tests). */
  gateway?: string | null;
  natPmpPort?: number;
  /** Disable a method (tests). */
  methods?: ("upnp" | "natpmp")[];
};

export class PortMapper {
  private status: PortMapStatus = {
    method: null,
    externalIp: null,
    mapped: [],
    warning: null,
    error: null,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private upnp: UpnpClient | null = null;
  private gateway: string | null = null;
  private ports: PortSpec[] = [];

  constructor(private readonly opts: PortMapperOptions) {}

  current(): PortMapStatus {
    return { ...this.status, mapped: [...this.status.mapped] };
  }

  async start(ports: PortSpec[]): Promise<PortMapStatus> {
    this.ports = ports;
    await this.map();
    return this.current();
  }

  /** Map the ports again now (the admin console's "refresh" action). */
  async refresh(): Promise<PortMapStatus> {
    await this.map();
    return this.current();
  }

  private async map(): Promise<void> {
    const methods = this.opts.methods ?? ["upnp", "natpmp"];
    const errors: string[] = [];
    let lease = this.opts.leaseSeconds;
    if (methods.includes("upnp")) {
      try {
        const gw =
          this.upnp?.gateway ??
          (await discoverGateway({
            fetchImpl: this.opts.fetchImpl,
            ...this.opts.discover,
          }));
        if (!gw) throw new Error("no UPnP gateway answered");
        this.upnp = new UpnpClient(gw, this.opts.fetchImpl);
        const host = new URL(gw.controlUrl).hostname;
        const internalClient = (await localAddressFor(host)) ?? "0.0.0.0";
        for (const p of this.ports) {
          const r = await this.upnp.addPortMapping({
            externalPort: p.external,
            internalPort: p.internal,
            internalClient,
            description: this.opts.description ?? "storage",
            leaseSeconds: this.opts.leaseSeconds,
          });
          lease = r.leaseSeconds;
        }
        const ip = await this.upnp.externalIp();
        this.done("upnp", ip, lease);
        return;
      } catch (err) {
        errors.push(`UPnP: ${(err as Error).message}`);
      }
    }
    if (methods.includes("natpmp")) {
      try {
        this.gateway ??= this.opts.gateway ?? (await defaultGateway());
        if (!this.gateway) throw new Error("default gateway unknown");
        const port = this.opts.natPmpPort ?? NATPMP_PORT;
        for (const p of this.ports) {
          const r = await natPmpMapTcp(
            this.gateway,
            p.internal,
            p.external,
            this.opts.leaseSeconds,
            port,
          );
          lease = r.lifetimeSeconds;
        }
        const ip = await natPmpExternalIp(this.gateway, port);
        this.done("natpmp", ip, lease);
        return;
      } catch (err) {
        errors.push(`NAT-PMP: ${(err as Error).message}`);
      }
    }
    this.status = {
      method: null,
      externalIp: null,
      mapped: [],
      warning: null,
      error: errors.join("; "),
    };
    this.opts.log.warn(
      `port mapping failed — forward the ports manually (${errors.join("; ")})`,
    );
    this.schedule(300);
  }

  private done(
    method: "upnp" | "natpmp",
    externalIp: string | null,
    lease: number,
  ): void {
    const warning = externalIp ? unreachableReason(externalIp) : null;
    this.status = {
      method,
      externalIp,
      mapped: [...this.ports],
      warning,
      error: null,
    };
    this.opts.log.status(
      `${method === "upnp" ? "UPnP" : "NAT-PMP"} mapped ${this.ports.map((p) => `${p.external}→${p.internal}`).join(", ")}${externalIp ? ` on ${externalIp}` : ""}`,
    );
    if (warning) this.opts.log.warn(warning);
    if (lease > 0) this.schedule(Math.max(30, Math.floor(lease / 2)));
  }

  private schedule(seconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.map(), seconds * 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { method } = this.status;
    for (const p of this.status.mapped) {
      try {
        if (method === "upnp" && this.upnp)
          await this.upnp.deletePortMapping(p.external);
        if (method === "natpmp" && this.gateway) {
          await natPmpMapTcp(
            this.gateway,
            p.internal,
            0,
            0,
            this.opts.natPmpPort ?? NATPMP_PORT,
          );
        }
      } catch (err) {
        this.opts.log.warn(`could not remove port mapping ${p.external}`, err);
      }
    }
    this.status = { ...this.status, mapped: [] };
  }
}
