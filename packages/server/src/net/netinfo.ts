// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Network facts the port mapper and `doctor` need: the default gateway, the
// local address used to reach it, and whether an "external" address is
// really private (double NAT / carrier-grade NAT), in which case no amount
// of port mapping makes the server reachable from the internet.

import { createSocket } from "node:dgram";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** The IPv4 default gateway from /proc/net/route (Linux), or null. */
export async function defaultGateway(
  routeFile = "/proc/net/route",
): Promise<string | null> {
  try {
    const text = await readFile(routeFile, "utf8");
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3 || cols[1] !== "00000000") continue;
      const hex = cols[2]!;
      const bytes = [0, 2, 4, 6]
        .map((i) => parseInt(hex.slice(i, i + 2), 16))
        .reverse();
      return bytes.join(".");
    }
  } catch {
    // not Linux, or no permission
  }
  return null;
}

/** The local address the OS would use to reach `host`. */
export function localAddressFor(
  host: string,
  port = 1900,
): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createSocket(isIP(host) === 6 ? "udp6" : "udp4");
    sock.on("error", () => {
      sock.close();
      resolve(null);
    });
    sock.connect(port, host, () => {
      const addr = sock.address().address;
      sock.close();
      resolve(addr);
    });
  });
}

/** Non-internal IPv4 addresses of this host (for self-signed SANs, LAN QR). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function v4(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").map(Number);
}

/** RFC 1918 private, loopback or link-local. */
export function isPrivateIPv4(ip: string): boolean {
  const b = v4(ip);
  if (!b) return false;
  const [a, c] = [b[0]!, b[1]!];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && c >= 16 && c <= 31) ||
    (a === 192 && c === 168) ||
    (a === 169 && c === 254)
  );
}

/** RFC 6598 shared address space used by carrier-grade NAT. */
export function isCgnat(ip: string): boolean {
  const b = v4(ip);
  return Boolean(b && b[0] === 100 && b[1]! >= 64 && b[1]! <= 127);
}

/** Why a gateway-reported external address cannot be reached, or null. */
export function unreachableReason(externalIp: string): string | null {
  if (isCgnat(externalIp)) {
    return `your router's WAN address ${externalIp} is carrier-grade NAT (100.64.0.0/10): your ISP shares one public IP between customers, so port forwarding cannot make this server reachable. Ask your ISP for a public IP, use IPv6, or run behind a tunnel (tls.mode=off with Cloudflare Tunnel / Tailscale Funnel).`;
  }
  if (isPrivateIPv4(externalIp)) {
    return `your router's WAN address ${externalIp} is private: there is another router in front of it (double NAT). Forward the port on the upstream router too, or put that router in bridge mode.`;
  }
  return null;
}
