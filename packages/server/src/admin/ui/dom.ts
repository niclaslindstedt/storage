// DOM helpers for the admin console UI: element builder, formatting, and a
// few components (badges, tables, dialogs, toasts). No framework, no
// innerHTML — text always goes in as text.

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown>;

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(child)),
  );
}

function applyProps(el: Element, props: Props | null | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.setAttribute("class", String(value));
    } else if (
      key === "value" ||
      key === "checked" ||
      key === "disabled" ||
      key === "selected"
    ) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

export function s(tag: string, props?: Props | null, ...children: Child[]) {
  const el = document.createElementNS(SVG, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function clear(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

// ---------------------------------------------------------------- formatting

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function num(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function ago(at: number | null | undefined): string {
  if (!at) return "never";
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 0) return `in ${duration(-s)}`;
  if (s < 5) return "just now";
  return `${duration(s)} ago`;
}

export function when(at: number | string | null | undefined): string {
  if (at === null || at === undefined) return "—";
  return new Date(at).toLocaleString();
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

// ---------------------------------------------------------------- components

export type Tone = "ok" | "warn" | "fail" | "info" | "muted";

export function badge(text: string, tone: Tone = "muted") {
  return h("span", { class: `badge ${tone}` }, text);
}

export function toneOf(status: string): Tone {
  if (status === "ok" || status === "active") return "ok";
  if (status === "warn" || status === "pending") return "warn";
  if (status === "fail" || status === "revoked" || status === "error")
    return "fail";
  return "muted";
}

export function card(title: Child, ...body: Child[]) {
  return h(
    "section",
    { class: "card" },
    title ? h("h2", null, title) : null,
    ...body,
  );
}

export function stat(
  label: string,
  value: Child,
  sub?: Child,
  tone?: Tone,
  testid?: string,
) {
  return h(
    "div",
    { class: `stat ${tone ?? ""}`, "data-testid": testid },
    h("div", { class: "stat-label" }, label),
    h("div", { class: "stat-value" }, value),
    sub ? h("div", { class: "stat-sub" }, sub) : null,
  );
}

export type Column<T> = {
  label: string;
  cell: (row: T) => Child;
  class?: string;
};

export function table<T>(
  columns: Column<T>[],
  rows: T[],
  opts: { empty?: string; testid?: string; rowTestid?: (r: T) => string } = {},
) {
  if (rows.length === 0)
    return h(
      "p",
      { class: "empty", "data-testid": opts.testid },
      opts.empty ?? "Nothing here yet.",
    );
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { "data-testid": opts.testid },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          columns.map((c) =>
            h("th", { scope: "col", class: c.class }, c.label),
          ),
        ),
      ),
      h(
        "tbody",
        null,
        rows.map((r) =>
          h(
            "tr",
            { "data-testid": opts.rowTestid?.(r) },
            columns.map((c) => h("td", { class: c.class }, c.cell(r))),
          ),
        ),
      ),
    ),
  );
}

export function kv(pairs: [string, Child][]) {
  return h(
    "dl",
    { class: "kv" },
    pairs.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
  );
}

// ---------------------------------------------------------------- dialogs

export function dialog(
  title: string,
  body: Child,
  opts: { testid?: string; wide?: boolean } = {},
): { el: HTMLDialogElement; close(): void } {
  const el = h(
    "dialog",
    {
      class: opts.wide ? "wide" : "",
      "data-testid": opts.testid,
      "aria-labelledby": "dialog-title",
    },
    h(
      "header",
      null,
      h("h2", { id: "dialog-title" }, title),
      h(
        "button",
        {
          type: "button",
          class: "icon",
          "aria-label": "Close",
          onclick: () => el.close(),
        },
        "✕",
      ),
    ),
    h("div", { class: "dialog-body" }, body),
  );
  el.addEventListener("close", () => el.remove());
  document.body.appendChild(el);
  el.showModal();
  return { el, close: () => el.close() };
}

/** Ask for confirmation; with `typed`, the user must type that text. */
export function confirm(opts: {
  title: string;
  message: Child;
  action: string;
  danger?: boolean;
  typed?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const input = opts.typed
      ? h("input", {
          id: "confirm-typed",
          autocomplete: "off",
          spellcheck: "false",
          "data-testid": "confirm-input",
        })
      : null;
    const go = h(
      "button",
      {
        type: "submit",
        class: opts.danger ? "danger" : "primary",
        disabled: Boolean(opts.typed),
        "data-testid": "confirm-button",
      },
      opts.action,
    );
    input?.addEventListener("input", () => {
      go.disabled = input.value !== opts.typed;
    });
    const form = h(
      "form",
      {
        method: "dialog",
        onsubmit: () => {
          ok = true;
        },
      },
      h("p", null, opts.message),
      input
        ? h(
            "p",
            null,
            h(
              "label",
              { for: "confirm-typed" },
              "Type ",
              h("strong", null, opts.typed!),
              " to confirm",
            ),
            input,
          )
        : null,
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
        go,
      ),
    );
    const d = dialog(opts.title, form, { testid: "confirm-dialog" });
    d.el.addEventListener("close", () => resolve(ok));
    (input ?? go).focus();
  });
}

// ---------------------------------------------------------------- toasts

let toastHost: HTMLElement | null = null;

export function toast(message: string, tone: Tone = "info"): void {
  toastHost ??= document.body.appendChild(
    h("div", { class: "toasts", role: "status", "aria-live": "polite" }),
  );
  const t = h(
    "div",
    { class: `toast ${tone}`, "data-testid": "toast" },
    message,
  );
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), tone === "fail" ? 8000 : 4000);
}

export async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", "ok");
  } catch {
    toast("Copy failed — select the text and copy it", "warn");
  }
}
