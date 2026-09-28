// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Draws the app's icons as PNGs with no dependencies: the admin console's
// mark (two stacked server bays and a stand, as in its favicon) in the
// console's accent. Run with `node scripts/generate-icons.mjs`; the PNGs
// are committed.
//
//   assets/icon.png           1024², white mark on the accent (iOS, legacy)
//   assets/adaptive-icon.png  1024², white mark inside Android's safe zone
//   assets/splash-icon.png     512², accent mark on transparent

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const ACCENT = [0x27, 0x43, 0xe6];
const WHITE = [0xff, 0xff, 0xff];

// The favicon's 32×32 geometry: [x, y, w, h, radius, opacity].
const MARK = [
  [3, 5, 26, 8, 3, 1],
  [3, 15, 26, 8, 3, 0.6],
  [13, 26, 6, 3, 0, 0.6],
];

function inRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Render: `size` px, the mark scaled into `inset`..(size-inset). */
function png(size, { bg, fg, inset }) {
  const SS = 4;
  const scale = (size - 2 * inset) / 32;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const mx = (x + (sx + 0.5) / SS - inset) / scale;
          const my = (y + (sy + 0.5) / SS - inset) / scale;
          let a = 0;
          for (const shape of MARK)
            if (inRoundRect(mx, my, shape)) a = Math.max(a, shape[5]);
          alpha += a;
        }
      alpha /= SS * SS;
      const bgA = bg ? 1 : 0;
      const outA = alpha + bgA * (1 - alpha);
      const mix = (i) =>
        outA === 0
          ? 0
          : Math.round(
              (fg[i] * alpha + (bg ? bg[i] : 0) * bgA * (1 - alpha)) / outA,
            );
      row.set([mix(0), mix(1), mix(2), Math.round(outA * 255)], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(
  join(OUT, "icon.png"),
  png(1024, { bg: ACCENT, fg: WHITE, inset: 200 }),
);
writeFileSync(
  join(OUT, "adaptive-icon.png"),
  png(1024, { bg: null, fg: WHITE, inset: 300 }),
);
writeFileSync(
  join(OUT, "splash-icon.png"),
  png(512, { bg: null, fg: ACCENT, inset: 40 }),
);
console.log("✓ wrote assets/icon.png, adaptive-icon.png, splash-icon.png");
