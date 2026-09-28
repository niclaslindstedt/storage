import { isRemote, post } from "../api.ts";
import { dialog, h, toast } from "../dom.ts";
import type { Account, AgentScope, Pairing } from "../types.ts";
import { showPairing } from "./pairing.ts";

/** What each agent permission lets an agent do (SPEC §11.3). */
const PERMS: [perm: string, label: string, hint: string, on: boolean][] = [
  [
    "data:read",
    "Read files and rows",
    "decrypted on the agent's machine",
    true,
  ],
  [
    "data:write",
    "Change files and rows",
    "write, move, delete to trash",
    false,
  ],
  ["sharing", "Share", "members, invites, joining, key rotation", false],
  ["devices", "Manage devices", "approve, add, revoke; recovery key", false],
];

const CONSOLE_PERMS: [string, string, string][] = [
  ["console:read", "Read the console", "health, logs, audit, accounts"],
  ["console:write", "Administer", "accounts, devices, maintenance"],
];

/** Scopes in words, for badges and hints. */
export function describeScope(s: AgentScope): string {
  return `${s.perms.join(", ") || "no permissions"} · ${s.apps ? s.apps.join(", ") : "all apps"}`;
}

/**
 * Pair an agent device: an AI agent's MCP server (`storage-mcp`), held by
 * the server to the permissions and apps chosen here. Console permissions
 * make it an admin device, so they are offered at the machine only.
 */
export function pairAgent(a: Account): void {
  const boxes = new Map<string, HTMLInputElement>();
  const row = (perm: string, label: string, hint: string, on: boolean) => {
    const box = h("input", {
      type: "checkbox",
      id: `agent-${perm}`,
      checked: on,
      "data-testid": `agent-perm-${perm}`,
    });
    boxes.set(perm, box);
    return h(
      "label",
      { class: "check", for: `agent-${perm}` },
      box,
      ` ${label} `,
      h("span", { class: "muted" }, `(${hint})`),
    );
  };
  const consoleRows =
    a.role === "admin" && !isRemote()
      ? CONSOLE_PERMS.map(([p, l, hint]) => row(p, l, hint, false))
      : [];
  const apps = h("input", {
    id: "agent-apps",
    autocomplete: "off",
    placeholder: "all apps — or e.g. drive, notes",
    "data-testid": "agent-apps",
  });
  const error = h("p", { class: "alert", hidden: true, role: "alert" });
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const perms = [...boxes].filter(([, b]) => b.checked).map(([p]) => p);
        const list = apps.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        try {
          const p = await post<Pairing>(`/api/accounts/${a.id}/pairing`, {
            agent: { perms, apps: list.length ? list : null },
            console: perms.some((x) => x.startsWith("console:")),
          });
          d.close();
          showPairing(p, a.name, "agent");
        } catch (err) {
          error.textContent = (err as Error).message;
          error.hidden = false;
          toast((err as Error).message, "fail");
        }
      },
    },
    h(
      "p",
      { class: "muted" },
      "An agent device is for an AI agent (the storage-mcp server) or a script. The server holds it to what you allow here on every request; you can narrow it later, never widen it. Anything it reads is decrypted on the agent's machine and may be sent to the agent's model provider — grant only what the agent needs.",
    ),
    error,
    ...PERMS.map(([p, l, hint, on]) => row(p, l, hint, on)),
    ...consoleRows,
    h("label", { for: "agent-apps" }, "Only these apps"),
    apps,
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
      h(
        "button",
        { type: "submit", class: "primary", "data-testid": "agent-submit" },
        "Create pairing code",
      ),
    ),
  );
  const d = dialog(`Pair an agent — ${a.name}`, form, {
    testid: "agent-dialog",
  });
}
