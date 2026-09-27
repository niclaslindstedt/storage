#!/usr/bin/env node
// Serve dist/ under the Pages base path (/storage/) for `npm run preview`
// and Lighthouse CI, with GitHub Pages' 404 behaviour.
//   node scripts/serve-dist.mjs [port]

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const BASE = "/storage/";
const port = Number(process.argv[2] ?? process.env.PORT ?? 4180);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(302, { location: BASE }).end();
    return;
  }
  let file = null;
  if (url.pathname.startsWith(BASE)) {
    const rel = normalize(decodeURIComponent(url.pathname.slice(BASE.length)));
    if (!rel.startsWith("..")) {
      const candidate = join(DIST, rel);
      if (existsSync(candidate) && statSync(candidate).isDirectory())
        file = join(candidate, "index.html");
      else file = candidate;
    }
  }
  const status = file && existsSync(file) ? 200 : 404;
  const path = status === 200 ? file : join(DIST, "404.html");
  res.writeHead(status, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(res);
}).listen(port, () =>
  console.log(`serving dist/ at http://localhost:${port}${BASE}`),
);
