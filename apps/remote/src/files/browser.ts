// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Inside a shared folder: browse, upload, open, rename, delete, restore an
// earlier version, empty the trash. Every name and byte is sealed on this
// phone by the framework's namespace (SPEC §4.3) before it is sent; large
// files go up in parts on their own.

import type {
  NamespaceFileInfo,
  SelfHostedClient,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  ago,
  bytes,
  clear,
  confirm,
  dialog,
  h,
  toast,
  when,
} from "@storage/console/dom.ts";

import { saveFile } from "../hosts.ts";
import { explain, field } from "../ui.ts";
import { folderHref } from "./drives.ts";
import { openSharing } from "./share.ts";
import {
  crumbs,
  FOLDER_MARKER,
  folderView,
  freeName,
  joinPath,
  nameProblem,
  parentOf,
} from "./tree.ts";

type Ctx = {
  client: SelfHostedClient;
  ns: StorageNamespace;
  folder: string;
  files: NamespaceFileInfo[];
  reload(): Promise<void>;
  status(text: string | null): void;
};

/** Ask for a name; resolves null when cancelled. */
function askName(title: string, initial: string, action: string) {
  return new Promise<string | null>((resolve) => {
    let result: string | null = null;
    const input = h("input", {
      autocomplete: "off",
      maxlength: "200",
      value: initial,
      "data-testid": "name-input",
    });
    const error = h("p", { class: "alert", role: "alert", hidden: true });
    const d = dialog(
      title,
      h(
        "form",
        {
          onsubmit(e: Event) {
            e.preventDefault();
            const problem = nameProblem(input.value);
            if (problem) {
              error.textContent = problem;
              error.hidden = false;
              return;
            }
            result = input.value;
            d.close();
          },
        },
        error,
        ...field("ask-name", "Name", input),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
          h(
            "button",
            { type: "submit", class: "primary", "data-testid": "name-submit" },
            action,
          ),
        ),
      ),
    );
    d.el.addEventListener("close", () => resolve(result));
    input.focus();
    input.select();
  });
}

async function upload(c: Ctx, list: FileList) {
  const taken = new Set(
    c.files
      .filter((f) => parentOf(f.path) === c.folder)
      .map((f) => f.path.slice(c.folder ? c.folder.length + 1 : 0)),
  );
  const all = [...list];
  let done = 0;
  for (const file of all) {
    const name = freeName(file.name.replaceAll("/", "∕"), taken);
    taken.add(name);
    c.status(`Encrypting and uploading ${done + 1} of ${all.length}: ${name}`);
    try {
      await c.ns.files.write(
        joinPath(c.folder, name),
        new Uint8Array(await file.arrayBuffer()),
        {
          mime: file.type || undefined,
          mtime: file.lastModified || undefined,
          ifAbsent: true,
        },
      );
      done++;
    } catch (err) {
      toast(`${name}: ${explain(err)}`, "fail");
    }
  }
  c.status(null);
  if (done) toast(`Uploaded ${done} file${done === 1 ? "" : "s"}`, "ok");
  await c.reload();
}

async function save(c: Ctx, f: NamespaceFileInfo) {
  c.status(`Downloading and decrypting ${f.path}`);
  try {
    const got = await c.ns.files.read(f.path);
    if (!got) throw new Error("The file is gone. Someone may have moved it.");
    await saveFile(
      f.path.slice(f.path.lastIndexOf("/") + 1),
      f.mime ?? "",
      got.bytes,
    );
  } catch (err) {
    toast(explain(err), "fail");
  }
  c.status(null);
}

async function rename(c: Ctx, from: string, isFolder: boolean) {
  const old = from.slice(from.lastIndexOf("/") + 1);
  const name = await askName(`Rename ${old}`, old, "Rename");
  if (!name || name === old) return;
  const to = joinPath(parentOf(from), name);
  try {
    if (isFolder) {
      const inside = c.files.filter((f) => f.path.startsWith(`${from}/`));
      for (const f of inside)
        await c.ns.files.move(f.path, to + f.path.slice(from.length));
    } else {
      await c.ns.files.move(from, to);
    }
    toast(`Renamed to ${name}`, "ok");
  } catch (err) {
    toast(explain(err), "fail");
  }
  await c.reload();
}

async function remove(c: Ctx, path: string, isFolder: boolean) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const inside = isFolder
    ? c.files.filter((f) => f.path.startsWith(`${path}/`))
    : [];
  const ok = await confirm({
    title: `Delete ${name}?`,
    message: isFolder
      ? `The folder and the ${inside.filter((f) => !f.path.endsWith(`/${FOLDER_MARKER}`)).length} file(s) in it go to the trash, where you can restore them for 30 days.`
      : "It goes to the trash, where you can restore it for 30 days.",
    action: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    for (const f of isFolder ? inside : [{ path }])
      await c.ns.files.delete(f.path);
    toast(`Deleted ${name}`, "ok");
  } catch (err) {
    toast(explain(err), "fail");
  }
  await c.reload();
}

async function versions(c: Ctx, f: NamespaceFileInfo) {
  const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const d = dialog(`Versions of ${f.path}`, body, { wide: true });
  try {
    const revs = await c.ns.files.history(f.path);
    clear(
      body,
      h(
        "ul",
        { class: "file-list compact" },
        revs.map((r, i) =>
          h(
            "li",
            null,
            h(
              "span",
              { class: "file-text" },
              h("span", { class: "file-name" }, when(r.createdAt)),
              h(
                "span",
                { class: "file-sub" },
                `${bytes(r.size)}${i === 0 ? " · current" : ""}`,
              ),
            ),
            i === 0
              ? null
              : h(
                  "button",
                  {
                    type: "button",
                    async onclick() {
                      try {
                        await c.ns.files.restore(f.path, r.rev);
                        toast("Restored that version", "ok");
                        d.close();
                        await c.reload();
                      } catch (err) {
                        toast(explain(err), "fail");
                      }
                    },
                  },
                  "Restore",
                ),
          ),
        ),
      ),
    );
  } catch (err) {
    clear(body, h("p", { class: "alert" }, explain(err)));
  }
}

async function trash(c: Ctx) {
  const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
  dialog("Trash", body, { wide: true, testid: "trash-dialog" });
  const load = async () => {
    try {
      const items = await c.ns.files.trash();
      // A folder's marker comes back with its files; it is not a file.
      const visible = items.filter(
        (t) =>
          t.path !== FOLDER_MARKER && !t.path.endsWith(`/${FOLDER_MARKER}`),
      );
      clear(
        body,
        visible.length === 0
          ? h("p", { class: "empty" }, "The trash is empty.")
          : h(
              "ul",
              { class: "file-list compact" },
              visible.map((t) =>
                h(
                  "li",
                  null,
                  h(
                    "span",
                    { class: "file-text" },
                    h("span", { class: "file-name" }, t.path),
                    h(
                      "span",
                      { class: "file-sub" },
                      `${bytes(t.size)} · deleted ${ago(t.deletedAt)}`,
                    ),
                  ),
                  h(
                    "div",
                    { class: "row-actions" },
                    h(
                      "button",
                      {
                        type: "button",
                        async onclick() {
                          await c.ns.files.restoreTrash(t.fileId);
                          toast(`Restored ${t.path}`, "ok");
                          await Promise.all([load(), c.reload()]);
                        },
                      },
                      "Restore",
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "danger",
                        async onclick() {
                          await c.ns.files.purgeTrash(t.fileId);
                          await load();
                        },
                      },
                      "Delete forever",
                    ),
                  ),
                ),
              ),
            ),
      );
    } catch (err) {
      clear(body, h("p", { class: "alert" }, explain(err)));
    }
  };
  await load();
}

function row(
  opts: {
    href?: string;
    icon: string;
    name: string;
    sub: string;
    testid: string;
    onOpen?: () => void;
  },
  ...actions: HTMLElement[]
) {
  const main = opts.href
    ? h("a", { class: "file-main", href: opts.href })
    : h("button", { type: "button", class: "file-main", onclick: opts.onOpen });
  main.append(
    h("span", { class: `icon ${opts.icon}`, "aria-hidden": "true" }),
    h(
      "span",
      { class: "file-text" },
      h("span", { class: "file-name" }, opts.name),
      h("span", { class: "file-sub" }, opts.sub),
    ),
  );
  const menu = h(
    "details",
    { class: "menu" },
    h("summary", { "aria-label": `Actions for ${opts.name}` }, "⋯"),
    h("div", { class: "menu-items" }, ...actions),
  );
  for (const a of actions)
    a.addEventListener("click", () => menu.removeAttribute("open"));
  return h("li", { "data-testid": opts.testid }, main, menu);
}

const action = (label: string, fn: () => void, danger = false) =>
  h(
    "button",
    { type: "button", class: danger ? "danger" : "", onclick: fn },
    label,
  );

export function renderBrowser(
  root: HTMLElement,
  client: SelfHostedClient,
  nsId: string,
  folder: string,
): () => void {
  const title = h("h1", null, "…");
  const trail = h("nav", { class: "crumbs", "aria-label": "Folder" });
  const statusLine = h("p", {
    class: "status-line",
    role: "status",
    hidden: true,
    "data-testid": "file-status",
  });
  const list = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const picker = h("input", {
    type: "file",
    multiple: true,
    hidden: true,
    "data-testid": "upload-input",
  });
  const toolbar = h("div", { class: "row-actions" });
  let stopped = false;
  let unwatch = () => {};

  const c: Ctx = {
    client,
    ns: null as unknown as StorageNamespace,
    folder,
    files: [],
    async reload() {
      if (stopped) return;
      try {
        c.files = await c.ns.files.list();
        draw();
      } catch (err) {
        clear(list, h("p", { class: "alert", role: "alert" }, explain(err)));
      }
    },
    status(text) {
      statusLine.hidden = text === null;
      statusLine.textContent = text ?? "";
    },
  };

  function draw() {
    const v = folderView(c.files, folder);
    const writable = c.ns.role !== "viewer";
    const items = [
      ...v.folders.map((f) =>
        row(
          {
            href: folderHref(nsId, f.path),
            icon: "folder",
            name: f.name,
            sub: `${f.files} file${f.files === 1 ? "" : "s"} · ${bytes(f.bytes)}`,
            testid: `folder-${f.name}`,
          },
          ...(writable
            ? [
                action("Rename", () => void rename(c, f.path, true)),
                action("Delete", () => void remove(c, f.path, true), true),
              ]
            : []),
        ),
      ),
      ...v.files.map((f) =>
        row(
          {
            icon: "file",
            name: f.name,
            sub: `${bytes(f.size)} · ${ago(f.mtime)}`,
            testid: `file-${f.name}`,
            onOpen: () => void save(c, f),
          },
          action("Save or share", () => void save(c, f)),
          action("Versions", () => void versions(c, f)),
          ...(writable
            ? [
                action("Rename", () => void rename(c, f.path, false)),
                action("Delete", () => void remove(c, f.path, false), true),
              ]
            : []),
        ),
      ),
    ];
    clear(
      list,
      items.length
        ? h("ul", { class: "file-list", "data-testid": "file-list" }, items)
        : h(
            "div",
            { class: "empty-state" },
            h("p", null, "This folder is empty."),
            writable
              ? h(
                  "p",
                  { class: "muted" },
                  "Upload files from this phone. They are encrypted before they leave it.",
                )
              : null,
          ),
    );
  }

  picker.addEventListener("change", () => {
    if (picker.files?.length) void upload(c, picker.files);
    picker.value = "";
  });

  clear(
    root,
    trail,
    h("div", { class: "page-header" }, title, toolbar),
    statusLine,
    list,
    picker,
  );

  void (async () => {
    try {
      c.ns = await client.namespace(nsId);
    } catch (err) {
      clear(list, h("p", { class: "alert", role: "alert" }, explain(err)));
      return;
    }
    if (stopped) return;
    const name = c.ns.meta.name;
    title.textContent = folder
      ? folder.slice(folder.lastIndexOf("/") + 1)
      : name;
    clear(
      trail,
      h("a", { href: "#/files" }, "Files"),
      " / ",
      crumbs(folder).length
        ? [
            h("a", { href: folderHref(nsId) }, name),
            crumbs(folder).map((p) => [
              " / ",
              h("a", { href: folderHref(nsId, p.path) }, p.name),
            ]),
          ]
        : h("span", null, name),
    );
    const writable = c.ns.role !== "viewer";
    clear(
      toolbar,
      c.ns.role === "owner"
        ? h(
            "button",
            {
              type: "button",
              "data-testid": "share",
              onclick: () => openSharing(c.ns),
            },
            "Share",
          )
        : null,
      h("button", { type: "button", onclick: () => void trash(c) }, "Trash"),
      writable
        ? h(
            "button",
            {
              type: "button",
              "data-testid": "new-subfolder",
              async onclick() {
                const n = await askName("New folder", "", "Create");
                if (!n) return;
                await c.ns.files
                  .write(joinPath(joinPath(folder, n), FOLDER_MARKER), "", {
                    ifAbsent: true,
                  })
                  .catch((err: unknown) => toast(explain(err), "fail"));
                await c.reload();
              },
            },
            "New folder",
          )
        : null,
      writable
        ? h(
            "button",
            {
              type: "button",
              class: "primary",
              "data-testid": "upload",
              onclick: () => picker.click(),
            },
            "Upload",
          )
        : null,
    );
    await c.reload();
    // Another device's upload or a share member's edit shows up at once.
    let pending: ReturnType<typeof setTimeout> | undefined;
    unwatch = c.ns.watch(() => {
      clearTimeout(pending);
      pending = setTimeout(() => void c.reload(), 300);
    });
  })();

  return () => {
    stopped = true;
    unwatch();
  };
}
