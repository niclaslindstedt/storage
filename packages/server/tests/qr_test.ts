import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

import { encodeQr, type Ecl, type QrCode } from "../src/qr/encode.ts";
import { qrToSvg, qrToTerminal } from "../src/qr/render.ts";

function decode(qr: QrCode): string | null {
  const scale = 4;
  const border = 4;
  const dim = (qr.size + border * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let py = 0; py < dim; py++) {
    for (let px = 0; px < dim; px++) {
      const x = Math.floor(px / scale) - border;
      const y = Math.floor(py / scale) - border;
      const isDark =
        x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.modules[y]![x];
      const i = (py * dim + px) * 4;
      const v = isDark ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, dim, dim)?.data ?? null;
}

describe("QR encoder", () => {
  it("encodes a pairing URI that decodes back", () => {
    const uri =
      "oss-storage://pair?v=1&s=https%3A%2F%2F203.0.113.7%3A8443&c=Q2hhbGxlbmdlLWNvZGUtMzItYnl0ZXMtYmFzZTY0dXJs&n=home";
    const qr = encodeQr(uri);
    expect(qr.size).toBe(qr.version * 4 + 17);
    expect(decode(qr)).toBe(uri);
  });

  it("round-trips across versions, levels and every mask", () => {
    const cases: [string, Ecl][] = [];
    for (const len of [1, 10, 30, 60, 120, 250, 500, 900]) {
      for (const ecl of ["L", "M", "Q", "H"] as Ecl[]) {
        cases.push([
          Array.from({ length: len }, (_, i) =>
            String.fromCharCode(33 + ((i * 7) % 90)),
          ).join(""),
          ecl,
        ]);
      }
    }
    const versions = new Set<number>();
    for (const [text, ecl] of cases) {
      let qr: QrCode;
      try {
        qr = encodeQr(text, { ecl });
      } catch {
        continue; // too long for H at 900 is fine
      }
      versions.add(qr.version);
      expect(decode(qr), `v${qr.version} ${ecl} len ${text.length}`).toBe(text);
    }
    expect(versions.size).toBeGreaterThan(10);
    for (let mask = 0; mask < 8; mask++) {
      expect(decode(encodeQr("mask test", { mask }))).toBe("mask test");
    }
  });

  it("handles UTF-8", () => {
    expect(decode(encodeQr("Hälsa ✓ 健康"))).toBe("Hälsa ✓ 健康");
  });

  it("renders SVG and terminal output", () => {
    const qr = encodeQr("hello");
    const svg = qrToSvg(qr);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    const term = qrToTerminal(qr, { ansi: false }).split("\n");
    expect(term).toHaveLength(Math.ceil((qr.size + 8) / 2));
    expect(qrToTerminal(qr)).toContain("\u001b[");
  });

  it("refuses data that cannot fit", () => {
    expect(() => encodeQr("x".repeat(3000), { ecl: "H" })).toThrow();
  });
});
