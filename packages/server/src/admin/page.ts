// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The loopback admin page: server status and "pair a device" with a QR code
// on screen. It listens on 127.0.0.1 only and every request must carry the
// per-process admin token printed at startup, so neither the network nor
// another site in the browser can drive it.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import type { Ctx } from "../context.ts";
import { ApiError } from "../errors.ts";
import { appLink, pairingUri } from "../payload.ts";
import { encodeQr } from "../qr/encode.ts";
import { qrToSvg } from "../qr/render.ts";
import { listAccounts } from "../services/accounts.ts";
import { createPairing } from "../services/pairing.ts";
import { constantTimeEqual, newSecret } from "../util/random.ts";

export type AdminStatus = () => Record<string, unknown>;

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1d1d1f;--muted:#6e6e73;--card:#fff;--line:#e5e5ea;--accent:#0a66c2}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#f5f5f7;--muted:#a1a1a6;--card:#1c1c1e;--line:#2c2c2e;--accent:#4ea1ff}}
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}main{max-width:760px;margin:0 auto;padding:24px 16px}
h1{font-size:22px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
code{font-size:13px;word-break:break-all}.muted{color:var(--muted)}button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font:inherit}
input,select{font:inherit;padding:6px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}.qr{background:#fff;display:inline-block;padding:8px;border-radius:8px}
</style></head><body><main>${body}</main></body></html>`;
}

export function startAdminPage(
  ctx: Ctx,
  opts: {
    port: number;
    status: AdminStatus;
    publicUrl: () => string;
    fp: () => string | undefined;
  },
): Promise<{ server: Server; url: string; token: string }> {
  const token = newSecret();

  function authorized(url: URL, form?: URLSearchParams): boolean {
    const t = form?.get("t") ?? url.searchParams.get("t") ?? "";
    return constantTimeEqual(t, token);
  }

  function home(): string {
    const st = opts.status();
    const accounts = listAccounts(ctx);
    return page(
      `${ctx.config.name} — storage`,
      `<h1>${esc(ctx.config.name)}</h1>
<section><h2>Status</h2><table>${Object.entries(st)
        .map(
          ([k, v]) =>
            `<tr><th>${esc(k)}</th><td><code>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</code></td></tr>`,
        )
        .join("")}</table></section>
<section><h2>Pair a device</h2>
<form method="post" action="/pair"><input type="hidden" name="t" value="${esc(token)}">
<p><label>Existing account <select name="account"><option value="">— new account —</option>${accounts
        .map(
          (a) =>
            `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.role)})</option>`,
        )
        .join("")}</select></label></p>
<p><label>or new account name <input name="name" autocomplete="off"></label>
<label>role <select name="role"><option>member</option><option>admin</option><option>guest</option></select></label></p>
<p><button type="submit">Show pairing QR code</button></p></form>
<p class="muted">The code is single-use and expires in ${Math.round(ctx.config.ttl.pairingSeconds / 60)} minutes. It only signs the device in; encryption keys never pass through this server.</p></section>
<section><h2>Accounts</h2><table><tr><th>Name</th><th>Role</th><th>Used</th><th>Quota</th></tr>${accounts
        .map(
          (a) =>
            `<tr><td>${esc(a.name)}</td><td>${esc(a.role)}</td><td>${a.usedBytes}</td><td>${a.quotaBytes ?? "∞"}</td></tr>`,
        )
        .join("")}</table></section>`,
    );
  }

  function pairResult(form: URLSearchParams): string {
    const account = form.get("account") || undefined;
    const name = form.get("name")?.trim() || undefined;
    const role = (form.get("role") ?? "member") as "admin" | "member" | "guest";
    const created = createPairing(
      ctx,
      account
        ? { accountId: account }
        : { newAccount: { name: name ?? "", role } },
      "admin-page",
    );
    const uri = pairingUri({
      server: opts.publicUrl(),
      code: created.code!,
      name: ctx.config.name,
      fp: opts.fp(),
    });
    const payload = ctx.config.appUrl ? appLink(ctx.config.appUrl, uri) : uri;
    const svg = qrToSvg(encodeQr(payload), { moduleSize: 6 });
    return page(
      "Pair a device",
      `<h1>Scan to pair</h1><section><div class="qr">${svg}</div>
<p>Expires <b>${esc(new Date(created.expiresAt).toLocaleString())}</b>.</p>
<p class="muted">Or paste into the app:</p><p><code>${esc(payload)}</code></p>
<p><a href="/?t=${esc(token)}">Back</a></p></section>`,
    );
  }

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'",
      );
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      try {
        if (req.method === "GET" && url.pathname === "/") {
          if (!authorized(url))
            return void res.writeHead(403).end("missing or wrong admin token");
          res
            .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            .end(home());
          return;
        }
        if (req.method === "POST" && url.pathname === "/pair") {
          let body = "";
          for await (const c of req) {
            body += c;
            if (body.length > 10_000) return void res.writeHead(413).end();
          }
          const form = new URLSearchParams(body);
          if (!authorized(url, form))
            return void res.writeHead(403).end("missing or wrong admin token");
          res
            .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            .end(pairResult(form));
          return;
        }
        res.writeHead(404).end();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "internal error";
        if (!(err instanceof ApiError)) ctx.log.error("admin page", err);
        res.writeHead(err instanceof ApiError ? err.status : 500, {
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(
          page(
            "Error",
            `<h1>Error</h1><p>${esc(msg)}</p><p><a href="/?t=${esc(token)}">Back</a></p>`,
          ),
        );
      }
    },
  );

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}/?t=${token}`, token });
    });
  });
}
