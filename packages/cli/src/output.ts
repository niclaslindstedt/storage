// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Human and machine output. On a terminal: aligned tables with headers,
// relative times and colour. Piped: tab-separated rows without headers and
// ISO times (like gh), so `cut` and `awk` work. --json prints the API's own
// JSON; --format prints each item with a {{.field}} template; -q prints ids.

export type Style = {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
};

const wrap = (on: boolean, code: number, reset: number) => (s: string) =>
  on ? `\u001b[${code}m${s}\u001b[${reset}m` : s;

export function style(color: boolean): Style {
  return {
    bold: wrap(color, 1, 22),
    dim: wrap(color, 2, 22),
    red: wrap(color, 31, 39),
    green: wrap(color, 32, 39),
    yellow: wrap(color, 33, 39),
    cyan: wrap(color, 36, 39),
  };
}

const ANSI = /\u001b\[[0-9;]*m/g;
export const visibleLength = (s: string) => s.replace(ANSI, "").length;

export type Column<T> = {
  header: string;
  value: (row: T) => string;
};

/** Aligned with a header on a terminal; tab-separated rows otherwise. */
export function table<T>(
  rows: T[],
  columns: Column<T>[],
  tty: boolean,
): string {
  const cells = rows.map((r) => columns.map((c) => c.value(r)));
  if (!tty)
    return cells
      .map((r) => r.map((c) => c.replace(ANSI, "")).join("\t"))
      .join("\n");
  const headers = columns.map((c) => c.header.toUpperCase());
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...cells.map((r) => visibleLength(r[i]!))),
  );
  const line = (r: string[]) =>
    r
      .map((c, i) =>
        i === r.length - 1 ? c : c + " ".repeat(widths[i]! - visibleLength(c)),
      )
      .join("   ")
      .trimEnd();
  return [line(headers), ...cells.map(line)].join("\n");
}

/** Label/value pairs, aligned. */
export function pairs(items: [string, string][], s: Style): string {
  const width = Math.max(0, ...items.map(([k]) => k.length));
  return items.map(([k, v]) => `${s.dim(k.padEnd(width))}  ${v}`).join("\n");
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return u === 0
    ? `${n} B`
    : `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}

/** Bytes, or a size with a unit: 500M, 10G, 1.5T (powers of 1024). */
export function parseSize(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgtp]?)(?:i?b)?\s*$/i.exec(text);
  if (!m) throw new Error(`not a size: ${text} (try 500M, 10G or bytes)`);
  const exp = " kmgtp".indexOf((m[2] || " ").toLowerCase());
  const n = Math.round(Number(m[1]) * 1024 ** exp);
  if (!Number.isSafeInteger(n)) throw new Error(`size too large: ${text}`);
  return n;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** "5 minutes ago" on a terminal, ISO 8601 otherwise. */
export function when(
  ms: number | null | undefined,
  tty: boolean,
  now = Date.now(),
): string {
  if (ms === null || ms === undefined) return tty ? "never" : "";
  if (!tty) return new Date(ms).toISOString();
  const diff = (now - ms) / 1000;
  const future = diff < 0;
  const a = Math.abs(diff);
  const [n, unit] =
    a < 45
      ? [0, "now"]
      : a < 3600
        ? [Math.round(a / 60), "minute"]
        : a < 86400
          ? [Math.round(a / 3600), "hour"]
          : a < 86400 * 45
            ? [Math.round(a / 86400), "day"]
            : a < 86400 * 365
              ? [Math.round(a / (86400 * 30)), "month"]
              : [Math.round(a / (86400 * 365)), "year"];
  if (unit === "now") return "just now";
  const label = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return future ? `in ${label}` : `${label} ago`;
}

function lookup(item: unknown, path: string): unknown {
  let v: unknown = item;
  for (const key of path.split(".").filter(Boolean)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

/** A docker-style template: {{.field}}, {{.a.b}}, {{json .}}, {{json .x}}. */
export function renderTemplate(template: string, item: unknown): string {
  const t = template.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
  return t.replace(
    /\{\{\s*(json\s+)?\.([A-Za-z0-9_.]*)\s*\}\}/g,
    (_, json, path: string) => {
      const v = lookup(item, path);
      if (json) return JSON.stringify(v);
      if (v === undefined || v === null) return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    },
  );
}
