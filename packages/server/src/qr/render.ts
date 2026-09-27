// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Render a QR code for a terminal (ANSI half blocks, readable on light and
// dark themes alike) and as a standalone SVG.

import type { QrCode } from "./encode.ts";

const QUIET = 4;

function dark(qr: QrCode, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.modules[y]![x]!;
}

/**
 * Two module rows per text line using "▀" with explicit foreground (top) and
 * background (bottom) colours, so the code scans on any terminal theme.
 * `ansi: false` falls back to plain block characters (dark on light).
 */
export function qrToTerminal(
  qr: QrCode,
  opts: { ansi?: boolean } = {},
): string {
  const ansi = opts.ansi ?? true;
  const lines: string[] = [];
  for (let y = -QUIET; y < qr.size + QUIET; y += 2) {
    let line = "";
    for (let x = -QUIET; x < qr.size + QUIET; x++) {
      const top = dark(qr, x, y);
      const bottom = dark(qr, x, y + 1);
      if (ansi) {
        line += `\u001b[${top ? 30 : 97}m\u001b[${bottom ? 40 : 107}m▀`;
      } else {
        line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      }
    }
    lines.push(ansi ? `${line}\u001b[0m` : line);
  }
  return lines.join("\n");
}

/** A self-contained SVG; one path, crisp at any size. */
export function qrToSvg(
  qr: QrCode,
  opts: { moduleSize?: number; dark?: string; light?: string } = {},
): string {
  const scale = opts.moduleSize ?? 8;
  const dim = (qr.size + QUIET * 2) * scale;
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y]![x]) d += `M${x + QUIET},${y + QUIET}h1v1h-1z`;
    }
  }
  const view = qr.size + QUIET * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${view} ${view}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${opts.light ?? "#ffffff"}"/>` +
    `<path d="${d}" fill="${opts.dark ?? "#000000"}"/></svg>`
  );
}
