import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeText,
  diffLines,
  diffText,
  looksLikeText,
  MAX_DIFF_BYTES,
  splitLines,
  toHunks,
  unified,
} from "../src/files/diff.ts";

const enc = (s: string) => new TextEncoder().encode(s);

/** Apply an edit script to `a`; it must give `b`. */
function apply(a: string[], ops: ReturnType<typeof diffLines>): string[] {
  const out: string[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.type === "same") {
      expect(a[i]).toBe(op.text);
      out.push(op.text);
      i++;
    } else if (op.type === "del") {
      expect(a[i]).toBe(op.text);
      i++;
    } else out.push(op.text);
  }
  expect(i).toBe(a.length);
  return out;
}

describe("text detection", () => {
  it("decodes UTF-8 text and refuses binary", () => {
    expect(decodeText(enc("héllo\nwörld\n"))).toBe("héllo\nwörld\n");
    expect(decodeText(enc("﻿bom"))).toBe("bom");
    expect(decodeText(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(decodeText(enc("a\u0000b"))).toBeNull();
    expect(decodeText(enc("\u0001\u0002\u0003".repeat(20)))).toBeNull();
    expect(decodeText(new Uint8Array(MAX_DIFF_BYTES + 1))).toBeNull();
  });

  it("offers a comparison for text types and names", () => {
    expect(looksLikeText("notes.md")).toBe(true);
    expect(looksLikeText("x", "text/plain")).toBe(true);
    expect(looksLikeText("data", "application/json")).toBe(true);
    expect(looksLikeText("photo.jpg", "image/jpeg")).toBe(false);
  });

  it("splits lines of every ending, without a phantom last line", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\rc")).toEqual(["a", "b", "c"]);
  });
});

describe("diffLines", () => {
  it("finds a shortest edit script that turns one into the other", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["abc", "abc"],
      ["", "abc"],
      ["abc", ""],
      ["abcabba", "cbabac"],
      ["xaxbxcx", "abc"],
      ["abcdefgh", "abXdefYh"],
    ];
    for (const [x, y] of cases) {
      const a = [...x];
      const b = [...y];
      const ops = diffLines(a, b);
      expect(apply(a, ops)).toEqual(b);
      // Myers' classic example has an edit distance of 5.
      if (x === "abcabba")
        expect(ops.filter((o) => o.type !== "same")).toHaveLength(5);
    }
  });

  it("stays correct on random edits", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(30) }, () => "abcd"[rnd(4)]!);
      const b = [...a];
      for (let e = rnd(6); e > 0; e--) {
        if (rnd(2) && b.length) b.splice(rnd(b.length), 1);
        else b.splice(rnd(b.length + 1), 0, "abcde"[rnd(5)]!);
      }
      expect(apply(a, diffLines(a, b))).toEqual(b);
    }
  });

  it("gives up line by line on a complete rewrite of a huge file", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`);
    const ops = diffLines(a, b);
    expect(apply(a, ops)).toEqual(b);
  });
});

describe("hunks", () => {
  it("keeps three lines of context and merges nearby changes", () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const b = [...a];
    b[1] = "changed 2";
    b[4] = "changed 5";
    b[17] = "changed 18";
    const hunks = toHunks(diffLines(a, b));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      aStart: 1,
      aLines: 8,
      bStart: 1,
      bLines: 8,
    });
    expect(hunks[1]).toMatchObject({
      aStart: 15,
      aLines: 6,
      bStart: 15,
      bLines: 6,
    });
  });

  it("matches diff -u", () => {
    const older = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
    const newer =
      "zero\none\ntwo\n3\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n";
    const d = diffText(older, newer);
    expect(d).toMatchObject({ added: 3, removed: 1 });
    const dir = mkdtempSync(join(tmpdir(), "diff-"));
    try {
      writeFileSync(join(dir, "a"), older);
      writeFileSync(join(dir, "b"), newer);
      let expected = "";
      try {
        execFileSync("diff", ["-u", "a", "b"], { cwd: dir });
      } catch (err) {
        expected = String((err as { stdout: Buffer }).stdout);
      }
      // Header lines carry timestamps; compare the hunks.
      const body = (s: string) => s.split("\n").slice(2).join("\n").trim();
      expect(body(unified(d, "a", "b"))).toBe(body(expected));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
