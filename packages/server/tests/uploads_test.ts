import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.ts";
import { readFile } from "../src/services/files.ts";
import { createNamespace } from "../src/services/namespaces.ts";
import {
  abortUpload,
  commitUpload,
  createUpload,
  putPart,
} from "../src/services/uploads.ts";
import { runRetention } from "../src/services/retention.ts";
import {
  envelope,
  envelopeB64u,
  principal,
  testContext,
  WRAP,
} from "./helpers.ts";

async function bytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return new Uint8Array(Buffer.concat(chunks));
}

describe("multi-part uploads", () => {
  it("assembles parts in order and commits with CAS", async () => {
    const ctx = testContext({ limits: { maxPartBytes: 80 } });
    const alice = principal(ctx, "alice");
    const ns = createNamespace(ctx, alice, {
      app: "contacts",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    const whole = envelope(1, 100, 5);
    const { uploadId } = createUpload(ctx, alice, ns.id);
    await putPart(ctx, alice, ns.id, uploadId, 2, whole.slice(64));
    await putPart(ctx, alice, ns.id, uploadId, 1, whole.slice(0, 64));
    await expect(
      putPart(ctx, alice, ns.id, uploadId, 3, new Uint8Array(81)),
    ).rejects.toThrow(ApiError);
    const done = await commitUpload(ctx, alice, ns.id, uploadId, {
      path: "photos/big",
      meta: envelopeB64u(),
    });
    expect(done.size).toBe(whole.byteLength);
    expect(
      await bytes((await readFile(ctx, alice, ns.id, "photos/big")).stream),
    ).toEqual(whole);
    // parts are released; only the assembled blob remains
    expect(
      ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM blobs")!.n,
    ).toBe(1);
  });

  it("aborts and expires", async () => {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const ns = createNamespace(ctx, alice, {
      app: "contacts",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    const a = createUpload(ctx, alice, ns.id);
    await putPart(ctx, alice, ns.id, a.uploadId, 1, envelope());
    await abortUpload(ctx, alice, ns.id, a.uploadId);
    const b = createUpload(ctx, alice, ns.id);
    await putPart(ctx, alice, ns.id, b.uploadId, 1, new Uint8Array([1, 2, 3]));
    ctx.clock.advance(2 * 24 * 3600_000);
    await runRetention(ctx);
    expect(
      ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM uploads")!.n,
    ).toBe(0);
    expect(
      ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM blobs")!.n,
    ).toBe(0);
  });

  it("rejects a commit whose content is not a current-epoch envelope", async () => {
    const ctx = testContext();
    const alice = principal(ctx, "alice");
    const ns = createNamespace(ctx, alice, {
      app: "contacts",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    const { uploadId } = createUpload(ctx, alice, ns.id);
    await putPart(ctx, alice, ns.id, uploadId, 1, new Uint8Array(50));
    await expect(
      commitUpload(ctx, alice, ns.id, uploadId, {
        path: "x",
        meta: envelopeB64u(),
      }),
    ).rejects.toThrow(ApiError);
  });
});
