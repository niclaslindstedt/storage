// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// UPnP Internet Gateway Device client: SSDP discovery, device description,
// and the three SOAP actions a home server needs — GetExternalIPAddress,
// AddPortMapping and DeletePortMapping on WANIPConnection (v1/v2) or
// WANPPPConnection.

import { createSocket } from "node:dgram";

import type { FetchImpl } from "../tls/acme.ts";

export const SSDP_ADDRESS = "239.255.255.250";
export const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANIPConnection:2",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
];

export type Gateway = {
  controlUrl: string;
  serviceType: string;
  location: string;
};

export type DiscoverOptions = {
  timeoutMs?: number;
  /** Where to send M-SEARCH (tests use a unicast fake). */
  address?: string;
  port?: number;
  fetchImpl?: FetchImpl;
};

/** Send SSDP M-SEARCH and return the first usable gateway, or null. */
export async function discoverGateway(
  opts: DiscoverOptions = {},
): Promise<Gateway | null> {
  const locations = await ssdpSearch(opts);
  for (const location of locations) {
    try {
      const gw = await describe(location, opts.fetchImpl ?? fetch);
      if (gw) return gw;
    } catch {
      // try the next responder
    }
  }
  return null;
}

function ssdpSearch(opts: DiscoverOptions): Promise<string[]> {
  const address = opts.address ?? SSDP_ADDRESS;
  const port = opts.port ?? SSDP_PORT;
  const timeout = opts.timeoutMs ?? 2500;
  return new Promise((resolve) => {
    const found: string[] = [];
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => {
      try {
        sock.close();
      } catch {
        // already closed
      }
      resolve([...new Set(found)]);
    };
    sock.on("message", (msg) => {
      const m = /^location:\s*(\S+)/im.exec(msg.toString("utf8"));
      if (m) found.push(m[1]!);
    });
    sock.on("error", finish);
    sock.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const req = [
          "M-SEARCH * HTTP/1.1",
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          "MX: 2",
          `ST: ${st}`,
          "",
          "",
        ].join("\r\n");
        sock.send(req, port, address);
      }
    });
    setTimeout(finish, timeout).unref();
  });
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(
    `<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`,
    "i",
  ).exec(xml);
  return m ? m[1]! : null;
}

async function describe(
  location: string,
  fetchImpl: FetchImpl,
): Promise<Gateway | null> {
  const res = await fetchImpl(location);
  if (!res.ok) return null;
  const xml = await res.text();
  const base = tag(xml, "URLBase") ?? location;
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = tag(block, "serviceType");
    const control = tag(block, "controlURL");
    if (!serviceType || !control) continue;
    if (/WAN(IP|PPP)Connection:\d/.test(serviceType)) {
      return {
        serviceType,
        controlUrl: new URL(control, base).toString(),
        location,
      };
    }
  }
  return null;
}

export class UpnpError extends Error {
  constructor(
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "UpnpError";
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class UpnpClient {
  constructor(
    readonly gateway: Gateway,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  private async soap(
    action: string,
    args: Record<string, string | number>,
  ): Promise<string> {
    const body =
      `<?xml version="1.0"?>` +
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      `<s:Body><u:${action} xmlns:u="${this.gateway.serviceType}">` +
      Object.entries(args)
        .map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
        .join("") +
      `</u:${action}></s:Body></s:Envelope>`;
    const res = await this.fetchImpl(this.gateway.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${this.gateway.serviceType}#${action}"`,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      const code = tag(text, "errorCode");
      const desc = tag(text, "errorDescription") ?? `HTTP ${res.status}`;
      throw new UpnpError(
        code ? Number(code) : null,
        `UPnP ${action} failed: ${desc}`,
      );
    }
    return text;
  }

  async externalIp(): Promise<string | null> {
    return tag(
      await this.soap("GetExternalIPAddress", {}),
      "NewExternalIPAddress",
    );
  }

  /** Map `externalPort` → `internalClient:internalPort`. Falls back to a
   *  permanent lease on routers that only support those (error 725). */
  async addPortMapping(m: {
    externalPort: number;
    internalPort: number;
    internalClient: string;
    protocol?: "TCP" | "UDP";
    description?: string;
    leaseSeconds?: number;
  }): Promise<{ leaseSeconds: number }> {
    const args = (lease: number) => ({
      NewRemoteHost: "",
      NewExternalPort: m.externalPort,
      NewProtocol: m.protocol ?? "TCP",
      NewInternalPort: m.internalPort,
      NewInternalClient: m.internalClient,
      NewEnabled: 1,
      NewPortMappingDescription: m.description ?? "storage",
      NewLeaseDuration: lease,
    });
    const lease = m.leaseSeconds ?? 3600;
    try {
      await this.soap("AddPortMapping", args(lease));
      return { leaseSeconds: lease };
    } catch (err) {
      if (err instanceof UpnpError && err.code === 725 && lease !== 0) {
        await this.soap("AddPortMapping", args(0));
        return { leaseSeconds: 0 };
      }
      throw err;
    }
  }

  async deletePortMapping(
    externalPort: number,
    protocol: "TCP" | "UDP" = "TCP",
  ): Promise<void> {
    await this.soap("DeletePortMapping", {
      NewRemoteHost: "",
      NewExternalPort: externalPort,
      NewProtocol: protocol,
    });
  }
}
