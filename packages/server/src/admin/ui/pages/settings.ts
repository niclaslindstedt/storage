// Settings (SPEC §11.1): how long earlier versions of files and deleted
// files are kept. Changes apply at once — to the next write of a file and
// the next housekeeping run — and win over the server's configuration.

import { get, patch } from "../api.ts";
import { badge, card, clear, h, toast } from "../dom.ts";
import { type Page, pageHeader } from "../page.ts";
import type { RetentionKey, Settings } from "../types.ts";

const FIELDS: {
  key: RetentionKey;
  label: string;
  unit: string;
  help: string;
}[] = [
  {
    key: "historyDays",
    label: "Keep earlier versions for",
    unit: "days",
    help: "When a file is overwritten, the version it replaced is kept this long, so it can be compared and restored. 0 keeps no earlier versions.",
  },
  {
    key: "historyCount",
    label: "At most",
    unit: "versions per file",
    help: "A limit for files that change very often. The oldest versions go first.",
  },
  {
    key: "trashDays",
    label: "Keep deleted files for",
    unit: "days",
    help: "Deleted files wait in their folder's trash this long before they are removed for good.",
  },
];

export const settingsPage: Page = {
  id: "settings",
  label: "Settings",
  async render(ctx) {
    const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
    ctx.root.append(
      pageHeader("Settings"),
      card(
        "Version history and trash",
        h(
          "p",
          { class: "muted" },
          "Files stay encrypted: the server keeps the older ciphertext, and only your devices can open or compare it. Earlier versions count against the folder owner's quota.",
        ),
        body,
      ),
    );

    const draw = (s: Settings) => {
      const inputs = new Map<RetentionKey, HTMLInputElement>();
      const error = h("p", { class: "alert", role: "alert", hidden: true });
      const rows = FIELDS.map((f) => {
        const [min, max] = s.limits[f.key];
        const input = h("input", {
          id: `setting-${f.key}`,
          type: "number",
          min: String(min),
          max: String(max),
          step: "1",
          required: true,
          inputmode: "numeric",
          value: String(s.retention[f.key]),
          "data-testid": `setting-${f.key}`,
        });
        inputs.set(f.key, input);
        const changed = s.changed.includes(f.key);
        return h(
          "div",
          { class: "setting" },
          h("label", { for: input.id }, f.label),
          h("div", { class: "setting-input" }, input, h("span", null, f.unit)),
          h(
            "p",
            { class: "muted small" },
            f.help,
            " ",
            changed
              ? [
                  badge("changed here", "info"),
                  " The configuration says ",
                  String(s.defaults[f.key]),
                  ". ",
                  h(
                    "button",
                    {
                      type: "button",
                      class: "link",
                      "data-testid": `reset-${f.key}`,
                      onclick: () => void save({ [f.key]: null }),
                    },
                    "Use that",
                  ),
                ]
              : `Default from the configuration: ${s.defaults[f.key]}.`,
          ),
        );
      });
      clear(
        body,
        h(
          "form",
          {
            class: "settings-form",
            onsubmit(e: Event) {
              e.preventDefault();
              const patchBody: Partial<Record<RetentionKey, number>> = {};
              for (const [k, input] of inputs) {
                const v = Number(input.value);
                if (v !== s.retention[k]) patchBody[k] = v;
              }
              if (Object.keys(patchBody).length === 0) {
                toast("Nothing changed", "info");
                return;
              }
              void save(patchBody).catch((err: Error) => {
                error.textContent = err.message;
                error.hidden = false;
              });
            },
          },
          error,
          rows,
          h(
            "div",
            { class: "actions start" },
            h(
              "button",
              {
                type: "submit",
                class: "primary",
                "data-testid": "settings-save",
              },
              "Save",
            ),
          ),
        ),
      );
    };

    async function save(body: Partial<Record<RetentionKey, number | null>>) {
      const s = await patch<Settings>("/api/settings", body);
      toast("Settings saved", "ok");
      draw(s);
    }

    try {
      draw(await get<Settings>("/api/settings"));
    } catch (err) {
      clear(
        body,
        h("p", { class: "alert", role: "alert" }, (err as Error).message),
      );
    }
  },
};
