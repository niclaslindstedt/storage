// The page contract: each page renders into its root and registers timers
// and subscriptions through the context, which the router tears down when
// the page is left.

import { clear, h } from "./dom.ts";

export type PageContext = {
  root: HTMLElement;
  /** Run `fn` now and every `ms` while the page is shown. */
  every(ms: number, fn: () => Promise<void> | void): void;
  onLeave(fn: () => void): void;
};

export type Page = {
  id: string;
  label: string;
  render(ctx: PageContext): Promise<void> | void;
};

export function pageHeader(title: string, ...extra: HTMLElement[]) {
  return h("div", { class: "page-header" }, h("h1", null, title), ...extra);
}

export function errorBox(err: unknown) {
  return h(
    "p",
    { class: "alert", role: "alert" },
    `Could not load: ${err instanceof Error ? err.message : String(err)}`,
  );
}

/** Replace `el`'s content with the result of `load`, or an error message. */
export async function refresh(
  el: HTMLElement,
  load: () => Promise<Node | Node[]>,
): Promise<void> {
  try {
    const out = await load();
    clear(el, out);
  } catch (err) {
    clear(el, errorBox(err));
  }
}
