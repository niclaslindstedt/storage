// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A file's versions (SPEC §6.4): every time a file is overwritten, the
// server keeps the version it replaced for the retention the admin set
// (`/v1/info` → retention, default 30 days). Here they are listed, saved,
// restored, and — for text — compared line by line. The server holds only
// ciphertext: each version is downloaded and decrypted on this device, and
// the comparison happens here too. Shared by Storage Remote and the web
// drive (apps/drive).

import type {
  SelfHostedClient,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  badge,
  bytes,
  clear,
  copy,
  dialog,
  h,
  toast,
  when,
} from "@storage/console/dom.ts";

import { saveFile } from "../hosts.ts";
import { explain } from "../ui.ts";
import {
  decodeText,
  diffText,
  looksLikeText,
  type TextDiff,
  unified,
} from "./diff.ts";
import { baseName } from "./tree.ts";

export type Retention = {
  historyDays: number;
  historyCount: number;
  trashDays: number;
};

const retentions = new WeakMap<SelfHostedClient, Promise<Retention | null>>();

/** What the server keeps (from `/v1/info`), or null for an older server. */
export function serverRetention(
  client: SelfHostedClient,
): Promise<Retention | null> {
  let p = retentions.get(client);
  if (!p) {
    p = client.transport
      .json<{ retention?: Retention }>("GET", "/v1/info")
      .then((i) => i.retention ?? null)
      .catch(() => null);
    retentions.set(client, p);
  }
  return p;
}

/** "30 days" / "1 day". */
export const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

type Version = { rev: string; size: number; mtime: number; createdAt: number };

/** Render a comparison of two versions: counts, then hunks with line numbers. */
export function renderDiff(d: TextDiff): HTMLElement {
  if (d.hunks.length === 0)
    return h(
      "p",
      { class: "muted", "data-testid": "diff-same" },
      "These versions have the same text.",
    );
  const num = (n: number | undefined) =>
    h("span", { class: "ln", "aria-hidden": "true" }, n ?? "");
  return h(
    "div",
    { class: "diff", "data-testid": "diff" },
    h(
      "p",
      { class: "diff-stats" },
      h("span", { class: "added" }, `+${d.added}`),
      " ",
      h("span", { class: "removed" }, `−${d.removed}`),
      ` line${d.added + d.removed === 1 ? "" : "s"}`,
    ),
    d.hunks.map((hk) =>
      h(
        "div",
        { class: "hunk" },
        h(
          "div",
          { class: "hunk-head" },
          `Lines ${hk.aStart}–${hk.aStart + Math.max(hk.aLines - 1, 0)} → ${hk.bStart}–${hk.bStart + Math.max(hk.bLines - 1, 0)}`,
        ),
        hk.lines.map((l) =>
          h(
            "div",
            {
              class: `dl ${l.type}`,
              "data-testid": l.type === "same" ? undefined : `diff-${l.type}`,
            },
            num(l.type === "add" ? undefined : l.a),
            num(l.type === "del" ? undefined : l.b),
            h(
              "span",
              {
                class: "sign",
                "aria-label":
                  l.type === "add"
                    ? "added"
                    : l.type === "del"
                      ? "removed"
                      : undefined,
              },
              l.type === "add" ? "+" : l.type === "del" ? "−" : " ",
            ),
            h("span", { class: "text" }, l.text || " "),
          ),
        ),
      ),
    ),
  );
}

/**
 * Open the versions of the file at `path`. `onRestored` runs after a version
 * was made current again (the list behind the dialog should reload).
 */
export async function openVersions(opts: {
  client: SelfHostedClient;
  ns: StorageNamespace;
  path: string;
  mime?: string | null;
  writable: boolean;
  onRestored(): void | Promise<void>;
}): Promise<void> {
  const { ns, path } = opts;
  const name = baseName(path);
  const text = looksLikeText(name, opts.mime);
  const note = h("p", { class: "muted small" });
  const list = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const compare = h("div", { class: "compare", hidden: true });
  const output = h("div", { class: "diff-output", "aria-live": "polite" });
  const d = dialog(
    `Versions of ${name}`,
    h("div", null, note, list, compare, output),
    { wide: true, testid: "versions-dialog" },
  );

  void serverRetention(opts.client).then((r) => {
    if (!r) return;
    note.textContent =
      r.historyDays === 0
        ? "This server keeps no earlier versions."
        : `When the file is replaced, the earlier version is kept for ${days(r.historyDays)} (at most ${r.historyCount} versions). They are encrypted like the file: only your devices can open them.`;
  });

  // Decrypted versions, fetched once each.
  const cache = new Map<string, Promise<Uint8Array>>();
  const bytesOf = (rev: string) => {
    let p = cache.get(rev);
    if (!p) {
      p = ns.files.readRevision(path, rev);
      p.catch(() => cache.delete(rev));
      cache.set(rev, p);
    }
    return p;
  };

  let versions: Version[];
  try {
    versions = await ns.files.history(path);
  } catch (err) {
    clear(list, h("p", { class: "alert", role: "alert" }, explain(err)));
    return;
  }
  const label = (v: Version, i: number) =>
    `${when(v.createdAt)}${i === 0 ? " (current)" : ""}`;

  async function show(older: Version, newer: Version) {
    const a = versions.indexOf(older);
    const b = versions.indexOf(newer);
    clear(output, h("p", { class: "muted" }, "Decrypting both versions…"));
    try {
      const [x, y] = await Promise.all([
        bytesOf(older.rev),
        bytesOf(newer.rev),
      ]);
      const tx = decodeText(x);
      const ty = decodeText(y);
      const heading = h(
        "h3",
        null,
        `Changes from ${label(older, a)} to ${label(newer, b)}`,
      );
      if (tx === null || ty === null) {
        clear(
          output,
          heading,
          h(
            "p",
            { class: "muted", "data-testid": "diff-binary" },
            `Only text files can be compared line by line. Sizes: ${bytes(x.byteLength)} → ${bytes(y.byteLength)}${x.byteLength === y.byteLength && same(x, y) ? " (identical)" : ""}.`,
          ),
        );
        return;
      }
      const diff = diffText(tx, ty);
      clear(
        output,
        h(
          "div",
          { class: "diff-head" },
          heading,
          diff.hunks.length
            ? h(
                "button",
                {
                  type: "button",
                  onclick: () =>
                    void copy(
                      unified(
                        diff,
                        `${name} (${label(older, a)})`,
                        `${name} (${label(newer, b)})`,
                      ),
                    ),
                },
                "Copy as diff",
              )
            : null,
        ),
        renderDiff(diff),
      );
    } catch (err) {
      clear(output, h("p", { class: "alert", role: "alert" }, explain(err)));
    }
  }

  // Compare any two: older on the left, newer on the right.
  const pick = (id: string, selected: number) =>
    h(
      "select",
      { id, "data-testid": id },
      versions.map((v, i) =>
        h(
          "option",
          { value: String(i), selected: i === selected },
          label(v, i),
        ),
      ),
    );
  const from = pick("compare-from", 1);
  const to = pick("compare-to", 0);
  if (versions.length > 1) {
    compare.hidden = false;
    clear(
      compare,
      h("label", { for: "compare-from" }, "Compare"),
      h(
        "div",
        { class: "compare-row" },
        from,
        h("span", { "aria-hidden": "true" }, "→"),
        to,
        h(
          "button",
          {
            type: "button",
            "data-testid": "compare",
            onclick() {
              const [x, y] = [Number(from.value), Number(to.value)];
              if (x === y) {
                toast("Pick two different versions", "warn");
                return;
              }
              // Always older → newer, whichever way round they were picked.
              void show(versions[Math.max(x, y)]!, versions[Math.min(x, y)]!);
            },
          },
          "Compare",
        ),
      ),
    );
  }

  clear(
    list,
    h(
      "ul",
      { class: "file-list compact", "data-testid": "versions" },
      versions.map((v, i) =>
        h(
          "li",
          { "data-testid": `version-${i}` },
          h(
            "span",
            { class: "file-text" },
            h(
              "span",
              { class: "file-name" },
              when(v.createdAt),
              " ",
              i === 0 ? badge("current", "ok") : null,
            ),
            h("span", { class: "file-sub" }, bytes(v.size)),
          ),
          h(
            "div",
            { class: "row-actions" },
            text && i < versions.length - 1
              ? h(
                  "button",
                  {
                    type: "button",
                    "data-testid": `changes-${i}`,
                    title: "What changed in this version",
                    onclick: () => void show(versions[i + 1]!, v),
                  },
                  "Changes",
                )
              : null,
            h(
              "button",
              {
                type: "button",
                async onclick() {
                  try {
                    await saveFile(name, opts.mime ?? "", await bytesOf(v.rev));
                  } catch (err) {
                    toast(explain(err), "fail");
                  }
                },
              },
              "Download",
            ),
            i > 0 && opts.writable
              ? h(
                  "button",
                  {
                    type: "button",
                    "data-testid": `restore-${i}`,
                    async onclick() {
                      try {
                        await ns.files.restore(path, v.rev);
                        toast("Restored that version", "ok");
                        d.close();
                        await opts.onRestored();
                      } catch (err) {
                        toast(explain(err), "fail");
                      }
                    },
                  },
                  "Restore",
                )
              : null,
          ),
        ),
      ),
    ),
    versions.length === 1
      ? h(
          "p",
          { class: "muted small" },
          "No earlier versions yet. They appear here when the file is replaced.",
        )
      : null,
  );
  // Open on what changed most recently.
  if (text && versions.length > 1) void show(versions[1]!, versions[0]!);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
