// Small SVG charts for the console: stacked bars per minute and a line.
// Sized by viewBox, so they scale with their container.

import { s } from "./dom.ts";

export type Series = { label: string; class: string; values: number[] };

const W = 600;
const H = 140;
const PAD = { l: 34, r: 6, t: 8, b: 18 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return v;
}

function axes(max: number, times: number[], unit: string) {
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const x = (i: number) =>
    PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, times.length);
  return [
    ...[0, 0.5, 1].map((f) => {
      const y = PAD.t + (1 - f) * (H - PAD.t - PAD.b);
      return [
        s("line", { class: "grid", x1: PAD.l, x2: W - PAD.r, y1: y, y2: y }),
        s(
          "text",
          { class: "axis", x: PAD.l - 4, y: y + 3, "text-anchor": "end" },
          `${Math.round(max * f * 10) / 10}${f === 1 ? unit : ""}`,
        ),
      ];
    }),
    ...[0, Math.floor(times.length / 2), times.length - 1]
      .filter((i) => times[i] !== undefined)
      .map((i) =>
        s(
          "text",
          {
            class: "axis",
            x: x(i),
            y: H - 4,
            "text-anchor":
              i === 0 ? "start" : i === times.length - 1 ? "end" : "middle",
          },
          fmt(times[i]!),
        ),
      ),
  ];
}

export function stackedBars(
  times: number[],
  series: Series[],
  opts: { unit?: string; label: string },
): SVGElement {
  const n = times.length;
  const totals = times.map((_, i) =>
    series.reduce((sum, se) => sum + (se.values[i] ?? 0), 0),
  );
  const max = niceMax(Math.max(0, ...totals));
  const plotH = H - PAD.t - PAD.b;
  const bw = (W - PAD.l - PAD.r) / Math.max(1, n);
  const bars = times.map((t, i) => {
    let y = H - PAD.b;
    const parts = series.map((se) => {
      const v = se.values[i] ?? 0;
      const hgt = (v / max) * plotH;
      y -= hgt;
      return v > 0
        ? s("rect", {
            class: se.class,
            x: PAD.l + i * bw + 0.5,
            y,
            width: Math.max(1, bw - 1),
            height: hgt,
          })
        : null;
    });
    const title = `${new Date(t).toLocaleTimeString()} — ${series
      .map((se) => `${se.label}: ${se.values[i] ?? 0}`)
      .join(", ")}`;
    return s(
      "g",
      null,
      s("title", null, title),
      s("rect", {
        class: "hit",
        x: PAD.l + i * bw,
        y: PAD.t,
        width: bw,
        height: plotH,
      }),
      ...parts,
    );
  });
  return s(
    "svg",
    {
      class: "chart",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": opts.label,
      preserveAspectRatio: "none",
    },
    ...axes(max, times, opts.unit ?? ""),
    ...bars,
  );
}

export function line(
  times: number[],
  values: number[],
  opts: { unit?: string; label: string; class?: string },
): SVGElement {
  const max = niceMax(Math.max(0, ...values));
  const plotH = H - PAD.t - PAD.b;
  const step = (W - PAD.l - PAD.r) / Math.max(1, times.length);
  const pts = values
    .map(
      (v, i) =>
        `${(PAD.l + i * step + step / 2).toFixed(1)},${(H - PAD.b - (v / max) * plotH).toFixed(1)}`,
    )
    .join(" ");
  return s(
    "svg",
    {
      class: "chart",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": opts.label,
      preserveAspectRatio: "none",
    },
    ...axes(max, times, opts.unit ?? ""),
    s("polyline", { class: opts.class ?? "line", points: pts }),
  );
}
