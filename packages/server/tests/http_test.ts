/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from "vitest";

import { createStorageServer, type StorageServer } from "../src/app.ts";
import { toB64u } from "../src/util/b64.ts";
import {
  deviceKeys,
  envelope,
  envelopeB64u,
  signChallenge,
  WRAP,
} from "./helpers.ts";

const servers: StorageServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function start(config = {}) {
  const server = createStorageServer({ config: { testMode: true, ...config } });
  servers.push(server);
  const url = await server.listen();
  const t = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        "X-Test-Secret": server.testSecret!,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  return { server, url, t };
}

async function pairedDevice(
  url: string,
  t: (p: string, i?: RequestInit) => Promise<Response>,
  name = "alice",
) {
  const seeded = await (
    await t("/__test/accounts", {
      method: "POST",
      body: JSON.stringify({ name, role: "admin" }),
    })
  ).json() as any;
  const keys = await deviceKeys();
  const pair = await fetch(`${url}/v1/pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.example",
    },
    body: JSON.stringify({
      code: seeded.pairingCode,
      device: { name: "d", platform: "web", ...keys },
    }),
  });
  expect(pair.status).toBe(201);
  const { deviceId, serverId } = await pair.json() as any;
  const ch = await (
    await fetch(`${url}/v1/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    })
  ).json() as any;
  const signature = await signChallenge(keys, serverId, deviceId, ch.challenge);
  const tok = await (
    await fetch(`${url}/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, challenge: ch.challenge, signature }),
    })
  ).json() as any;
  const api = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${tok.token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  return {
    api,
    deviceId,
    accountId: seeded.account.id as string,
    token: tok.token as string,
    pairingUri: seeded.pairingUri as string,
  };
}

describe("HTTP API", () => {
  it("serves /v1/info with security headers", async () => {
    const { url } = await start();
    const res = await fetch(`${url}/v1/info`);
    expect(res.status).toBe(200);
    const info = await res.json() as any;
    expect(info).toMatchObject({ protocol: 1, name: "storage" });
    expect(info.capabilities).toContain("records");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("pairs, authenticates and rejects unauthenticated calls", async () => {
    const { url, t } = await start();
    const { api, pairingUri } = await pairedDevice(url, t);
    expect(pairingUri).toMatch(/^oss-storage:\/\/pair\?v=1&s=http/);
    const me = await (await api("/v1/me")).json() as any;
    expect(me.account).toMatchObject({ name: "alice", role: "admin" });
    const anon = await fetch(`${url}/v1/me`);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as any).error.code).toBe("unauthenticated");
    expect((await fetch(`${url}/v1/nope`)).status).toBe(404);
    expect((await fetch(`${url}/v1/info`, { method: "DELETE" })).status).toBe(
      405,
    );
  });

  it("round-trips files with ETags and answers 412 on stale writes", async () => {
    const { url, t } = await start();
    const { api } = await pairedDevice(url, t);
    const ns = await (
      await api("/v1/namespaces", {
        method: "POST",
        body: JSON.stringify({
          app: "notes",
          meta: envelopeB64u(),
          wrap: WRAP,
        }),
      })
    ).json() as any;
    const body = envelope(1, 32, 4);
    const put = await api(`/v1/ns/${ns.id}/files/dir/file`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Meta": envelopeB64u(),
        "If-None-Match": "*",
      },
      body,
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get("etag")!;
    const get = await api(`/v1/ns/${ns.id}/files/dir/file`);
    expect(get.headers.get("etag")).toBe(etag);
    expect(get.headers.get("x-meta")).toBe(envelopeB64u());
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);
    const head = await api(`/v1/ns/${ns.id}/files/dir/file`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);

    await api(`/v1/ns/${ns.id}/files/dir/file`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Meta": envelopeB64u(),
        "If-Match": etag,
      },
      body: envelope(1, 32, 5),
    });
    const stale = await api(`/v1/ns/${ns.id}/files/dir/file`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Meta": envelopeB64u(),
        "If-Match": etag,
      },
      body: envelope(1, 32, 6),
    });
    expect(stale.status).toBe(412);
    const err = await stale.json() as any;
    expect(err.error.code).toBe("conflict");
    expect(err.error.current.rev).not.toBe(etag.replaceAll('"', ""));

    const list = await (await api(`/v1/ns/${ns.id}/files?recursive=1`)).json() as any;
    expect(list.entries.map((e: { path: string }) => e.path)).toEqual([
      "dir/file",
    ]);
  });

  it("records, batch and change feed over HTTP", async () => {
    const { url, t } = await start();
    const { api } = await pairedDevice(url, t);
    const ns = await (
      await api("/v1/namespaces", {
        method: "POST",
        body: JSON.stringify({ app: "meds", meta: envelopeB64u(), wrap: WRAP }),
      })
    ).json() as any;
    const put = await api(`/v1/ns/${ns.id}/records/days/k1`, {
      method: "PUT",
      body: JSON.stringify({ value: envelopeB64u(1, 4, 1) }),
    });
    expect(put.status).toBe(200);
    const rev = ((await put.json()) as any).rev;
    const stale = await api(`/v1/ns/${ns.id}/records/days/k1`, {
      method: "PUT",
      headers: { "If-Match": `"${Number(rev) - 1}"` },
      body: JSON.stringify({ value: envelopeB64u(1, 4, 2) }),
    });
    expect(stale.status).toBe(412);
    const batch = await (
      await api(`/v1/ns/${ns.id}/batch`, {
        method: "POST",
        body: JSON.stringify({
          atomic: true,
          ops: [
            {
              op: "put",
              collection: "days",
              key: "k2",
              value: envelopeB64u(1, 4, 3),
            },
          ],
        }),
      })
    ).json() as any;
    expect(batch.results[0].ok).toBe(true);
    const feed = await (
      await api(`/v1/ns/${ns.id}/changes?since=${ns.seq}`)
    ).json() as any;
    expect(feed.changes.map((c: { key: string }) => c.key)).toEqual([
      "k1",
      "k2",
    ]);
  });

  it("streams events over SSE", async () => {
    const { url, t } = await start();
    const { api, token } = await pairedDevice(url, t);
    const ns = await (
      await api("/v1/namespaces", {
        method: "POST",
        body: JSON.stringify({ app: "meds", meta: envelopeB64u(), wrap: WRAP }),
      })
    ).json() as any;
    const ac = new AbortController();
    const res = await fetch(`${url}/v1/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await until("event: hello");
    await api(`/v1/ns/${ns.id}/records/c/k`, {
      method: "PUT",
      body: JSON.stringify({ value: envelopeB64u() }),
    });
    await until("event: ns");
    expect(text).toContain(`"ns":"${ns.id}"`);
    ac.abort();
  });

  it("CORS: public endpoints for any origin, private ones for paired origins only", async () => {
    const { url, t } = await start();
    const { token } = await pairedDevice(url, t); // pairs from https://app.example
    const pre = await fetch(`${url}/v1/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
    expect(pre.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
    const evil = await fetch(`${url}/v1/me`, {
      headers: {
        Origin: "https://evil.example",
        Authorization: `Bearer ${token}`,
      },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const pub = await fetch(`${url}/v1/pair`, {
      method: "OPTIONS",
      headers: { Origin: "https://new.example" },
    });
    expect(pub.headers.get("access-control-allow-origin")).toBe(
      "https://new.example",
    );
  });

  it("rate-limits unauthenticated endpoints", async () => {
    const { url } = await start({ rateLimit: { publicPerMinute: 4 } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${url}/v1/auth/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "dev_AAAAAAAAAAAAAAAAAAAAAA" }),
      });
      codes.push(r.status);
      if (r.status === 429)
        expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
    }
    expect(codes).toContain(429);
  });

  it("rejects oversized and malformed bodies", async () => {
    const { url, t } = await start({ limits: { maxBodyBytes: 1024 } });
    const { api } = await pairedDevice(url, t);
    const bad = await api("/v1/namespaces", {
      method: "POST",
      body: "{not json",
    });
    expect(bad.status).toBe(400);
    const ns = await (
      await api("/v1/namespaces", {
        method: "POST",
        body: JSON.stringify({ app: "x", meta: envelopeB64u(), wrap: WRAP }),
      })
    ).json() as any;
    const big = await api(`/v1/ns/${ns.id}/files/f`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Meta": envelopeB64u(),
      },
      body: envelope(1, 2000),
    });
    expect(big.status).toBe(413);
  });
});

describe("test mode", () => {
  it("requires the test secret", async () => {
    const { url } = await start();
    const res = await fetch(`${url}/__test/reset`, {
      method: "POST",
      headers: { "X-Test-Secret": "nope" },
    });
    expect(res.status).toBe(403);
  });

  it("injects faults, snapshots, restores and resets", async () => {
    const { url, t } = await start();
    const { api } = await pairedDevice(url, t);
    await t("/__test/faults", {
      method: "POST",
      body: JSON.stringify({
        rules: [
          {
            match: { path: "/v1/me" },
            action: "status",
            status: 503,
            times: 1,
          },
        ],
      }),
    });
    expect((await api("/v1/me")).status).toBe(503);
    expect((await api("/v1/me")).status).toBe(200);

    await t("/__test/faults", {
      method: "POST",
      body: JSON.stringify({
        rules: [{ match: {}, action: "offline", times: 1 }],
      }),
    });
    await expect(api("/v1/me")).rejects.toThrow();

    const snap = await (await t("/__test/snapshot")).json() as any;
    await api("/v1/namespaces", {
      method: "POST",
      body: JSON.stringify({ app: "x", meta: envelopeB64u(), wrap: WRAP }),
    });
    expect(
      ((await (await api("/v1/namespaces")).json()) as any).namespaces,
    ).toHaveLength(1);
    await t("/__test/restore", { method: "POST", body: JSON.stringify(snap) });
    expect(
      ((await (await api("/v1/namespaces")).json()) as any).namespaces,
    ).toHaveLength(0);
    await t("/__test/reset", { method: "POST" });
    expect((await api("/v1/me")).status).toBe(401);
  });

  it("moves the clock so tokens expire", async () => {
    const { url, t } = await start();
    const { api } = await pairedDevice(url, t);
    expect((await api("/v1/me")).status).toBe(200);
    await t("/__test/clock", {
      method: "POST",
      body: JSON.stringify({ advanceMs: 11 * 60_000 }),
    });
    expect((await api("/v1/me")).status).toBe(401);
  });

  it("is absent outside test mode", async () => {
    const server = createStorageServer({});
    servers.push(server);
    const url = await server.listen();
    expect(
      (await fetch(`${url}/__test/reset`, { method: "POST" })).status,
    ).toBe(404);
    void toB64u;
  });
});
