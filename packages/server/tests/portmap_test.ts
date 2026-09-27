import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryLogger } from "../src/log.ts";
import { natPmpExternalIp, natPmpMapTcp } from "../src/net/natpmp.ts";
import {
  defaultGateway,
  isCgnat,
  isPrivateIPv4,
  unreachableReason,
} from "../src/net/netinfo.ts";
import { PortMapper } from "../src/net/portmap.ts";
import { discoverGateway, UpnpClient } from "../src/net/upnp.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

type Mapping = {
  external: number;
  internal: number;
  client: string;
  lease: number;
};

async function fakeIgd(
  opts: { externalIp?: string; permanentOnly?: boolean } = {},
) {
  const mappings = new Map<number, Mapping>();
  const http: Server = createServer(async (req, res) => {
    if (req.url === "/desc.xml") {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(`<?xml version="1.0"?><root><device><deviceList><device><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
        <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service>
        </serviceList></device></deviceList></device></root>`);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const action = String(req.headers.soapaction)
      .split("#")[1]!
      .replace('"', "");
    const val = (n: string) =>
      new RegExp(`<${n}>([^<]*)</${n}>`).exec(body)?.[1] ?? "";
    const ok = (inner = "") =>
      res
        .writeHead(200, { "Content-Type": "text/xml" })
        .end(
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="x">${inner}</u:${action}Response></s:Body></s:Envelope>`,
        );
    if (action === "GetExternalIPAddress")
      return ok(
        `<NewExternalIPAddress>${opts.externalIp ?? "203.0.113.7"}</NewExternalIPAddress>`,
      );
    if (action === "AddPortMapping") {
      const lease = Number(val("NewLeaseDuration"));
      if (opts.permanentOnly && lease !== 0) {
        res
          .writeHead(500)
          .end(
            `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>725</errorCode><errorDescription>OnlyPermanentLeasesSupported</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`,
          );
        return;
      }
      mappings.set(Number(val("NewExternalPort")), {
        external: Number(val("NewExternalPort")),
        internal: Number(val("NewInternalPort")),
        client: val("NewInternalClient"),
        lease,
      });
      return ok();
    }
    if (action === "DeletePortMapping") {
      mappings.delete(Number(val("NewExternalPort")));
      return ok();
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const httpPort = (http.address() as AddressInfo).port;
  const ssdp: Socket = createSocket("udp4");
  ssdp.on("message", (msg, rinfo) => {
    if (!msg.toString().startsWith("M-SEARCH")) return;
    ssdp.send(
      `HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:${httpPort}/desc.xml\r\n\r\n`,
      rinfo.port,
      rinfo.address,
    );
  });
  await new Promise<void>((r) => ssdp.bind(0, "127.0.0.1", r));
  cleanups.push(() => new Promise((r) => http.close(() => r())));
  cleanups.push(() => void ssdp.close());
  return { mappings, ssdpPort: ssdp.address().port };
}

async function fakeNatPmp(externalIp = "198.51.100.9") {
  const mappings = new Map<number, number>();
  const sock = createSocket("udp4");
  sock.on("message", (msg, rinfo) => {
    if (msg[1] === 0) {
      const out = Buffer.alloc(12);
      out[1] = 128;
      externalIp.split(".").forEach((b, i) => (out[8 + i] = Number(b)));
      sock.send(out, rinfo.port, rinfo.address);
    } else if (msg[1] === 2) {
      const internal = msg.readUInt16BE(4);
      const external = msg.readUInt16BE(6);
      const life = msg.readUInt32BE(8);
      if (life === 0) mappings.delete(internal);
      else mappings.set(internal, external);
      const out = Buffer.alloc(16);
      out[1] = 130;
      out.writeUInt16BE(internal, 8);
      out.writeUInt16BE(external, 10);
      out.writeUInt32BE(life, 12);
      sock.send(out, rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((r) => sock.bind(0, "127.0.0.1", r));
  cleanups.push(() => void sock.close());
  return { mappings, port: sock.address().port };
}

describe("netinfo", () => {
  it("classifies addresses", () => {
    expect(isPrivateIPv4("192.168.1.5")).toBe(true);
    expect(isPrivateIPv4("172.20.0.1")).toBe(true);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isCgnat("100.72.1.1")).toBe(true);
    expect(unreachableReason("100.72.1.1")).toMatch(/carrier-grade NAT/);
    expect(unreachableReason("10.0.0.2")).toMatch(/double NAT/);
    expect(unreachableReason("203.0.113.7")).toBeNull();
  });

  it("reads the default gateway from a route table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "route");
    writeFileSync(
      file,
      "Iface\tDestination\tGateway \tFlags\nwlan0\t0001A8C0\t00000000\t0001\nwlan0\t00000000\t0101A8C0\t0003\n",
    );
    expect(await defaultGateway(file)).toBe("192.168.1.1");
  });
});

describe("UPnP", () => {
  it("discovers the gateway, maps, reads the external IP and unmaps", async () => {
    const igd = await fakeIgd();
    const gw = await discoverGateway({
      address: "127.0.0.1",
      port: igd.ssdpPort,
      timeoutMs: 500,
    });
    expect(gw?.serviceType).toBe(
      "urn:schemas-upnp-org:service:WANIPConnection:1",
    );
    const client = new UpnpClient(gw!);
    expect(await client.externalIp()).toBe("203.0.113.7");
    await client.addPortMapping({
      externalPort: 443,
      internalPort: 8443,
      internalClient: "127.0.0.1",
    });
    expect(igd.mappings.get(443)).toMatchObject({
      internal: 8443,
      client: "127.0.0.1",
      lease: 3600,
    });
    await client.deletePortMapping(443);
    expect(igd.mappings.size).toBe(0);
  });

  it("falls back to a permanent lease when the router demands it", async () => {
    const igd = await fakeIgd({ permanentOnly: true });
    const gw = await discoverGateway({
      address: "127.0.0.1",
      port: igd.ssdpPort,
      timeoutMs: 500,
    });
    const r = await new UpnpClient(gw!).addPortMapping({
      externalPort: 80,
      internalPort: 8080,
      internalClient: "127.0.0.1",
    });
    expect(r.leaseSeconds).toBe(0);
    expect(igd.mappings.get(80)!.lease).toBe(0);
  });
});

describe("NAT-PMP", () => {
  it("reads the external address and maps / unmaps", async () => {
    const gw = await fakeNatPmp();
    expect(await natPmpExternalIp("127.0.0.1", gw.port)).toBe("198.51.100.9");
    const m = await natPmpMapTcp("127.0.0.1", 8443, 443, 3600, gw.port);
    expect(m).toEqual({ externalPort: 443, lifetimeSeconds: 3600 });
    expect(gw.mappings.get(8443)).toBe(443);
  });
});

describe("PortMapper", () => {
  it("prefers UPnP and cleans up on stop", async () => {
    const igd = await fakeIgd();
    const log = createMemoryLogger();
    const pm = new PortMapper({
      log,
      leaseSeconds: 3600,
      discover: { address: "127.0.0.1", port: igd.ssdpPort, timeoutMs: 500 },
    });
    const st = await pm.start([
      { internal: 8443, external: 443 },
      { internal: 8080, external: 80 },
    ]);
    expect(st).toMatchObject({
      method: "upnp",
      externalIp: "203.0.113.7",
      warning: null,
    });
    expect([...igd.mappings.keys()].sort()).toEqual([443, 80].sort());
    await pm.stop();
    expect(igd.mappings.size).toBe(0);
  });

  it("falls back to NAT-PMP and warns about CGNAT", async () => {
    const gw = await fakeNatPmp("100.80.0.1");
    const log = createMemoryLogger();
    const pm = new PortMapper({
      log,
      leaseSeconds: 3600,
      discover: { address: "127.0.0.1", port: 9, timeoutMs: 200 },
      gateway: "127.0.0.1",
      natPmpPort: gw.port,
    });
    const st = await pm.start([{ internal: 8443, external: 443 }]);
    expect(st.method).toBe("natpmp");
    expect(st.warning).toMatch(/carrier-grade/);
    expect(
      log.lines.some(
        (l) => l.startsWith("WARN") && l.includes("carrier-grade"),
      ),
    ).toBe(true);
    await pm.stop();
    expect(gw.mappings.size).toBe(0);
  });

  it("reports failure with actionable text when nothing answers", async () => {
    const pm = new PortMapper({
      log: createMemoryLogger(),
      leaseSeconds: 60,
      methods: ["upnp"],
      discover: { address: "127.0.0.1", port: 9, timeoutMs: 100 },
    });
    const st = await pm.start([{ internal: 1, external: 1 }]);
    expect(st.method).toBeNull();
    expect(st.error).toMatch(/UPnP/);
    await pm.stop();
  });
});
