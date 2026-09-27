import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type BlobStore,
  createFsBlobStore,
  createMemoryBlobStore,
} from "../src/blobs.ts";
import { sha256Hex } from "../src/util/random.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fsStore(): BlobStore {
  const dir = mkdtempSync(join(tmpdir(), "storage-blobs-"));
  dirs.push(dir);
  return createFsBlobStore(dir);
}

async function readStream(store: BlobStore, hash: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of store.stream(hash)!) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

for (const [name, make] of [
  ["memory", createMemoryBlobStore],
  ["fs", fsStore],
] as const) {
  describe(`${name} blob store`, () => {
    it("addresses content by sha-256 and is idempotent", async () => {
      const store = make();
      const data = new TextEncoder().encode("hello");
      const a = await store.write(data);
      const b = await store.write(data);
      expect(a).toEqual({ hash: sha256Hex(data), size: 5 });
      expect(b).toEqual(a);
      expect(await store.has(a.hash)).toBe(true);
      expect(Buffer.from((await store.read(a.hash))!).toString()).toBe(
        "hello",
      );
      expect((await readStream(store, a.hash)).toString()).toBe("hello");
    });

    it("returns null for unknown hashes and removes idempotently", async () => {
      const store = make();
      const { hash } = await store.write(new Uint8Array([1, 2, 3]));
      await store.remove(hash);
      await store.remove(hash);
      expect(await store.read(hash)).toBeNull();
      expect(store.stream(hash)).toBeNull();
      expect(await store.has(hash)).toBe(false);
      expect(await store.read("0".repeat(64))).toBeNull();
    });

    it("concatenates parts into a new blob", async () => {
      const store = make();
      const p1 = await store.write(new TextEncoder().encode("abc"));
      const p2 = await store.write(new TextEncoder().encode("def"));
      const joined = await store.concat([p1.hash, p2.hash]);
      expect(joined.size).toBe(6);
      expect(joined.hash).toBe(sha256Hex("abcdef"));
      expect(Buffer.from((await store.read(joined.hash))!).toString()).toBe(
        "abcdef",
      );
    });

    it("lists stored hashes", async () => {
      const store = make();
      const a = await store.write(new Uint8Array([1]));
      const b = await store.write(new Uint8Array([2]));
      const all: string[] = [];
      for await (const h of store.list()) all.push(h);
      expect(all.sort()).toEqual([a.hash, b.hash].sort());
    });

    it("rejects malformed hashes (no path traversal)", async () => {
      const store = make();
      await expect(store.read("../../etc/passwd")).rejects.toThrow();
    });
  });
}

describe("fs blob store layout", () => {
  it("shards files and leaves no temp files behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "storage-blobs-"));
    dirs.push(dir);
    const store = createFsBlobStore(dir);
    const { hash } = await store.write(new Uint8Array([9, 9]));
    expect(readdirSync(join(dir, hash.slice(0, 2), hash.slice(2, 4)))).toEqual([
      hash,
    ]);
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });
});
