// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Differences between two versions of a text file, computed on the device:
// the server holds only ciphertext, so it can neither tell text from binary
// nor compare. A line diff (Myers, O((N+M)·D) after trimming the common
// head and tail) grouped into hunks with a few lines of context, like
// `diff -u`. Pure — the versions dialog and the tests read it.

/** Larger files are not compared (both are decrypted into memory). */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;

/** Beyond this many changed lines the files are treated as rewritten. */
const MAX_EDITS = 2000;

export type DiffLine =
  | { type: "same"; text: string; a: number; b: number }
  | { type: "del"; text: string; a: number }
  | { type: "add"; text: string; b: number };

export type Hunk = {
  /** First line (1-based) and line count in the older and newer text. */
  aStart: number;
  aLines: number;
  bStart: number;
  bLines: number;
  lines: DiffLine[];
};

export type TextDiff = {
  added: number;
  removed: number;
  hunks: Hunk[];
};

const TEXT_TYPES =
  /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|sql|x-httpd-php|ld\+json|xhtml\+xml|x-tex|rtf))/;
const TEXT_NAMES =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|ya?ml|toml|ini|cfg|conf|env|log|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sql|tex|srt|vtt|ics|vcf|svg|gitignore)$/i;

/** Whether a file is worth offering a text comparison for, by type or name. */
export function looksLikeText(name: string, mime?: string | null): boolean {
  return (!!mime && TEXT_TYPES.test(mime)) || TEXT_NAMES.test(name);
}

/**
 * The bytes as text, or null when they are not (invalid UTF-8, NUL bytes,
 * or mostly control characters) or too large to compare.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_DIFF_BYTES) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return null;
    if (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) control++;
  }
  return control > text.length / 100 + 8 ? null : text.replace(/^\uFEFF/, "");
}

/** Lines without their endings; a final newline does not add an empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The edit script turning `a` into `b`, line by line. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  // Common head and tail cost nothing and are most of a typical edit.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++)
    out.push({ type: "same", text: a[i]!, a: i + 1, b: i + 1 });
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  for (const op of myers(midA, midB)) {
    if (op.type === "same") out.push({ ...op, a: op.a + head, b: op.b + head });
    else if (op.type === "del") out.push({ ...op, a: op.a + head });
    else out.push({ ...op, b: op.b + head });
  }
  for (let i = tail; i > 0; i--) {
    const ai = a.length - i;
    const bi = b.length - i;
    out.push({ type: "same", text: a[ai]!, a: ai + 1, b: bi + 1 });
  }
  return out;
}

/** Myers' greedy shortest edit script; 1-based line numbers in the result. */
function myers(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text, i) => ({ type: "add", text, b: i + 1 }));
  if (m === 0) return a.map((text, i) => ({ type: "del", text, a: i + 1 }));
  // Compare numbers, not strings, in the inner loop.
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) ids.set(s, (v = ids.size));
    return v;
  };
  const x0 = a.map(id);
  const y0 = b.map(id);
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  // trace[d]: the furthest x on diagonals -d..d before round d (only those
  // are read back), so memory grows with D², not with the file.
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && x0[x] === y0[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) {
    // Too different to be worth a line-by-line answer: all out, all in.
    return [
      ...a.map((text, i): DiffLine => ({ type: "del", text, a: i + 1 })),
      ...b.map((text, i): DiffLine => ({ type: "add", text, b: i + 1 })),
    ];
  }
  // Walk the trace back from (n, m).
  const ops: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const at = (k: number) => vd[k + d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: "same", text: a[x - 1]!, a: x, b: y });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) ops.push({ type: "add", text: b[y - 1]!, b: y });
    else ops.push({ type: "del", text: a[x - 1]!, a: x });
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** Group an edit script into hunks with `context` unchanged lines around each change. */
export function toHunks(lines: DiffLine[], context = 3): Hunk[] {
  // Each change wants [i - context, i + context]; overlapping wants merge.
  const ranges: [number, number][] = [];
  lines.forEach((l, i) => {
    if (l.type === "same") return;
    const lo = Math.max(0, i - context);
    const hi = Math.min(lines.length, i + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  });
  // Lines of each side before index i.
  const aUpTo = [0];
  const bUpTo = [0];
  for (const l of lines) {
    aUpTo.push(aUpTo[aUpTo.length - 1]! + (l.type !== "add" ? 1 : 0));
    bUpTo.push(bUpTo[bUpTo.length - 1]! + (l.type !== "del" ? 1 : 0));
  }
  return ranges.map(([lo, hi]) => {
    const body = lines.slice(lo, hi);
    // `diff -u` numbers from 1, and names the line before the hunk when a
    // side has no lines in it (e.g. -0,0 for an insertion at the top).
    const aBefore = aUpTo[lo]!;
    const bBefore = bUpTo[lo]!;
    const aLines = body.filter((l) => l.type !== "add").length;
    const bLines = body.filter((l) => l.type !== "del").length;
    return {
      aStart: aLines ? aBefore + 1 : aBefore,
      aLines,
      bStart: bLines ? bBefore + 1 : bBefore,
      bLines,
      lines: body,
    };
  });
}

/** Compare two texts: what was added and removed, in hunks. */
export function diffText(older: string, newer: string, context = 3): TextDiff {
  const lines = diffLines(splitLines(older), splitLines(newer));
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
    hunks: toHunks(lines, context),
  };
}

/** The diff as `diff -u` text (for copying). */
export function unified(d: TextDiff, older: string, newer: string): string {
  const out = [`--- ${older}`, `+++ ${newer}`];
  for (const h of d.hunks) {
    out.push(`@@ -${h.aStart},${h.aLines} +${h.bStart},${h.bLines} @@`);
    for (const l of h.lines)
      out.push(
        `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${l.text}`,
      );
  }
  return out.join("\n");
}
