import { download, get, openEvents } from "../api.ts";
import { badge, clear, clock, h, toast, toneOf } from "../dom.ts";
import { type Page, pageHeader } from "../page.ts";
import type { LogEntry } from "../types.ts";

const RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const MAX_ROWS = 2000;

export const logsPage: Page = {
  id: "logs",
  label: "Logs",
  async render(ctx) {
    const level = h(
      "select",
      { "aria-label": "Minimum level", "data-testid": "log-level" },
      (["debug", "info", "warn", "error"] as const).map((l) =>
        h(
          "option",
          { value: l, selected: l === "info" },
          l === "debug" ? "all levels" : `${l} and above`,
        ),
      ),
    );
    const search = h("input", {
      type: "search",
      placeholder: "Search",
      "aria-label": "Search logs",
      "data-testid": "log-search",
    });
    const pause = h(
      "button",
      { type: "button", "aria-pressed": "false", "data-testid": "log-pause" },
      "Pause",
    );
    const status = h(
      "span",
      { class: "muted", "data-testid": "log-status" },
      "connecting…",
    );
    const list = h("ol", {
      class: "log",
      "data-testid": "log-list",
      "aria-live": "off",
    });
    const entries: LogEntry[] = [];
    let paused = false;
    let queued: LogEntry[] = [];

    const visible = (e: LogEntry) =>
      RANK[e.level] >= RANK[level.value as keyof typeof RANK] &&
      (!search.value ||
        e.message.toLowerCase().includes(search.value.toLowerCase()));

    const row = (e: LogEntry) =>
      h(
        "li",
        { class: `lvl-${e.level}` },
        h("time", { datetime: new Date(e.at).toISOString() }, clock(e.at)),
        badge(
          e.level,
          e.level === "info"
            ? "info"
            : e.level === "debug"
              ? "muted"
              : toneOf(e.level === "warn" ? "warn" : "fail"),
        ),
        h("span", { class: "msg" }, e.message),
      );

    const atBottom = () =>
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    function rerender() {
      clear(list, entries.filter(visible).map(row));
      list.scrollTop = list.scrollHeight;
    }
    function add(e: LogEntry) {
      entries.push(e);
      if (entries.length > MAX_ROWS) entries.shift();
      if (!visible(e)) return;
      const stick = atBottom();
      list.appendChild(row(e));
      while (list.childElementCount > MAX_ROWS)
        list.firstElementChild?.remove();
      if (stick) list.scrollTop = list.scrollHeight;
    }

    level.addEventListener("change", rerender);
    search.addEventListener("input", rerender);
    pause.addEventListener("click", () => {
      paused = !paused;
      pause.textContent = paused ? "Resume" : "Pause";
      pause.setAttribute("aria-pressed", String(paused));
      if (!paused) {
        for (const e of queued) add(e);
        queued = [];
      }
    });

    ctx.root.append(
      pageHeader(
        "Logs",
        h(
          "button",
          {
            type: "button",
            onclick: () =>
              download("/api/logs/file").catch((err: Error) =>
                toast(err.message, "fail"),
              ),
          },
          "Download debug log",
        ),
      ),
      h("div", { class: "toolbar" }, level, search, pause, status),
      list,
      h(
        "p",
        { class: "muted" },
        "The newest 2000 lines since the server started. The debug log file on disk keeps everything, including debug lines. Logs never contain content, names or keys.",
      ),
    );

    const initial = await get<{ entries: LogEntry[] }>("/api/logs?limit=2000");
    for (const e of initial.entries) entries.push(e);
    rerender();
    const last = entries.at(-1)?.seq ?? 0;
    const stop = openEvents(`/api/logs/stream?after=${last}`, {
      open: () => (status.textContent = "live"),
      error: () => (status.textContent = "reconnecting…"),
      event(name, data) {
        if (name !== "log") return;
        const e = JSON.parse(data) as LogEntry;
        if (entries.length && e.seq <= entries.at(-1)!.seq) return;
        if (paused) queued.push(e);
        else add(e);
      },
    });
    ctx.onLeave(stop);
  },
};
