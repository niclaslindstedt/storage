// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// NAT-PMP (RFC 6886) — the port-mapping protocol Apple routers and many
// others speak when UPnP is off. Two requests: the external address, and a
// TCP mapping with a lifetime (lifetime 0 deletes it).

import { createSocket } from "node:dgram";

export const NATPMP_PORT = 5351;

const RESULT_TEXT = [
  "success",
  "unsupported version",
  "not authorized",
  "network failure",
  "out of resources",
  "unsupported opcode",
];

async function request(
  gateway: string,
  packet: Buffer,
  expectOp: number,
  port: number,
  attempts = 4,
): Promise<Buffer> {
  let timeout = 250;
  for (let i = 0; i < attempts; i++, timeout *= 2) {
    const reply = await new Promise<Buffer | null>((resolve) => {
      const sock = createSocket("udp4");
      const timer = setTimeout(() => {
        sock.close();
        resolve(null);
      }, timeout);
      sock.on("message", (msg) => {
        if (msg.length >= 2 && msg[1] === expectOp) {
          clearTimeout(timer);
          sock.close();
          resolve(msg);
        }
      });
      sock.on("error", () => {
        clearTimeout(timer);
        sock.close();
        resolve(null);
      });
      sock.send(packet, port, gateway);
    });
    if (reply) {
      const code = reply.readUInt16BE(2);
      if (code !== 0)
        throw new Error(`NAT-PMP: ${RESULT_TEXT[code] ?? `error ${code}`}`);
      return reply;
    }
  }
  throw new Error(`NAT-PMP: no answer from ${gateway}`);
}

export async function natPmpExternalIp(
  gateway: string,
  port = NATPMP_PORT,
): Promise<string> {
  const reply = await request(gateway, Buffer.from([0, 0]), 128, port);
  return [8, 9, 10, 11].map((i) => reply[i]).join(".");
}

/** Map a TCP port; returns the external port and granted lifetime. */
export async function natPmpMapTcp(
  gateway: string,
  internalPort: number,
  externalPort: number,
  lifetimeSeconds: number,
  port = NATPMP_PORT,
): Promise<{ externalPort: number; lifetimeSeconds: number }> {
  const pkt = Buffer.alloc(12);
  pkt[0] = 0;
  pkt[1] = 2; // TCP
  pkt.writeUInt16BE(internalPort, 4);
  pkt.writeUInt16BE(externalPort, 6);
  pkt.writeUInt32BE(lifetimeSeconds, 8);
  const reply = await request(gateway, pkt, 130, port);
  return {
    externalPort: reply.readUInt16BE(10),
    lifetimeSeconds: reply.readUInt32BE(12),
  };
}
