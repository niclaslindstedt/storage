// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Content-addressed byte storage. A blob is named by the SHA-256 of its bytes
// (which, for everything user-authored, are ciphertext), so a write is
// idempotent and a name can never point at the wrong bytes. Reference counts
// live in the database (`blob-refs.ts`); this layer only moves bytes.

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type BlobInfo = { hash: string; size: number };

export interface BlobStore {
  write(data: Uint8Array): Promise<BlobInfo>;
  /** Join existing blobs, in order, into a new one (multi-part uploads). */
  concat(hashes: readonly string[]): Promise<BlobInfo>;
  read(hash: string): Promise<Uint8Array | null>;
  stream(hash: string): Readable | null;
  has(hash: string): Promise<boolean>;
  remove(hash: string): Promise<void>;
  list(): AsyncIterable<string>;
}

const HASH = /^[0-9a-f]{64}$/;

function checkHash(hash: string): void {
  if (!HASH.test(hash)) throw new Error(`invalid blob hash: ${hash}`);
}

function hashOf(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async write(data) {
      const hash = hashOf(data);
      if (!blobs.has(hash)) blobs.set(hash, new Uint8Array(data));
      return { hash, size: data.byteLength };
    },
    async concat(hashes) {
      const parts = hashes.map((h) => {
        checkHash(h);
        const b = blobs.get(h);
        if (!b) throw new Error(`missing blob ${h}`);
        return b;
      });
      return this.write(Buffer.concat(parts));
    },
    async read(hash) {
      checkHash(hash);
      return blobs.get(hash) ?? null;
    },
    stream(hash) {
      checkHash(hash);
      const b = blobs.get(hash);
      return b ? Readable.from([Buffer.from(b)]) : null;
    },
    async has(hash) {
      checkHash(hash);
      return blobs.has(hash);
    },
    async remove(hash) {
      checkHash(hash);
      blobs.delete(hash);
    },
    async *list() {
      yield* [...blobs.keys()];
    },
  };
}

export function createFsBlobStore(root: string): BlobStore {
  const tmp = join(root, "tmp");
  let ready: Promise<void> | null = null;
  const ensure = () =>
    (ready ??= mkdir(tmp, { recursive: true, mode: 0o700 }).then(() => {}));

  const pathOf = (hash: string) => {
    checkHash(hash);
    return join(root, hash.slice(0, 2), hash.slice(2, 4), hash);
  };

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  // Write to a temp file, fsync, then rename into place: a crash mid-write
  // never leaves a truncated file under a content address.
  async function commit(
    tmpPath: string,
    hash: string,
    size: number,
  ): Promise<BlobInfo> {
    const final = pathOf(hash);
    if (await exists(final)) {
      await rm(tmpPath, { force: true });
      return { hash, size };
    }
    await mkdir(join(root, hash.slice(0, 2), hash.slice(2, 4)), {
      recursive: true,
      mode: 0o700,
    });
    await rename(tmpPath, final);
    return { hash, size };
  }

  const tmpName = () => join(tmp, randomBytes(12).toString("hex"));

  return {
    async write(data) {
      await ensure();
      const hash = hashOf(data);
      if (await exists(pathOf(hash))) return { hash, size: data.byteLength };
      const t = tmpName();
      const fh = await open(t, "wx", 0o600);
      try {
        await fh.writeFile(data);
        await fh.sync();
      } finally {
        await fh.close();
      }
      return commit(t, hash, data.byteLength);
    },
    async concat(hashes) {
      await ensure();
      const t = tmpName();
      const hasher = createHash("sha256");
      let size = 0;
      const out = createWriteStream(t, { flags: "wx", mode: 0o600 });
      try {
        for (const h of hashes) {
          const src = createReadStream(pathOf(h));
          src.on("data", (chunk) => {
            hasher.update(chunk);
            size += chunk.length;
          });
          await pipeline(src, out, { end: false });
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          out.end((err?: Error | null) => (err ? reject(err) : resolve())),
        );
      }
      const fh = await open(t, "r+");
      await fh.sync();
      await fh.close();
      return commit(t, hasher.digest("hex"), size);
    },
    async read(hash) {
      try {
        return new Uint8Array(await readFile(pathOf(hash)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    stream(hash) {
      const p = pathOf(hash);
      try {
        // Synchronous existence check keeps the API simple for callers that
        // need to answer 404 before streaming.
        statSync(p);
      } catch {
        return null;
      }
      return createReadStream(p);
    },
    async has(hash) {
      return exists(pathOf(hash));
    },
    async remove(hash) {
      await rm(pathOf(hash), { force: true });
    },
    async *list() {
      let top: string[] = [];
      try {
        top = await readdir(root);
      } catch {
        return;
      }
      for (const a of top) {
        if (!/^[0-9a-f]{2}$/.test(a)) continue;
        for (const b of await readdir(join(root, a))) {
          for (const name of await readdir(join(root, a, b))) {
            if (HASH.test(name)) yield name;
          }
        }
      }
    },
  };
}
