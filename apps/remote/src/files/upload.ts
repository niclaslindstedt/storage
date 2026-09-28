// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Uploading into a folder. A file whose name is already taken either
// replaces it — a new version of the same file; the server keeps the one it
// replaced (SPEC §5 retention), so it can be compared and restored — or is
// kept beside it as "name (2)". Every byte is sealed on this device before
// it is sent; large files go up in parts (the framework does that).

import type {
  NamespaceFileInfo,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { dialog, h, toast } from "@storage/console/dom.ts";

import { explain } from "../ui.ts";
import { freeName, joinPath, parentOf } from "./tree.ts";

export type Collision = "replace" | "keep";

/** Ask what to do with uploads whose names are taken; null = cancel. */
export function askCollision(names: string[]): Promise<Collision | null> {
  return new Promise((resolve) => {
    let answer: Collision | null = null;
    const pick = (a: Collision) => () => {
      answer = a;
      d.close();
    };
    const d = dialog(
      names.length === 1
        ? `${names[0]} already exists`
        : `${names.length} files already exist`,
      h(
        "div",
        null,
        h(
          "p",
          null,
          names.length === 1
            ? "Replace it with the one you are uploading? "
            : `Replace them with the ones you are uploading? (${names.join(", ")}) `,
          "The version it replaces is kept, so you can compare the two and get it back.",
        ),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
          h(
            "button",
            {
              type: "button",
              "data-testid": "keep-both",
              onclick: pick("keep"),
            },
            "Keep both",
          ),
          h(
            "button",
            {
              type: "button",
              class: "primary",
              "data-testid": "replace",
              onclick: pick("replace"),
            },
            "Replace",
          ),
        ),
      ),
      { testid: "collision-dialog" },
    );
    d.el.addEventListener("close", () => resolve(answer));
  });
}

/**
 * Encrypt and upload `files` into `folder`. `existing` is what the folder
 * holds now (to find names that are taken). Resolves with how many went up.
 */
export async function uploadFiles(opts: {
  ns: StorageNamespace;
  folder: string;
  files: File[];
  existing: NamespaceFileInfo[];
  status(text: string | null): void;
}): Promise<number> {
  const { ns, folder, files } = opts;
  const here = new Map(
    opts.existing
      .filter((f) => parentOf(f.path) === folder)
      .map((f) => [f.path.slice(folder ? folder.length + 1 : 0), f]),
  );
  const clean = (f: File) => f.name.replaceAll("/", "∕");
  const clashes = files.map(clean).filter((n) => here.has(n));
  let choice: Collision = "keep";
  if (clashes.length) {
    const a = await askCollision([...new Set(clashes)]);
    if (!a) return 0;
    choice = a;
  }
  const taken = new Set(here.keys());
  let done = 0;
  let replaced = 0;
  for (const [i, file] of files.entries()) {
    const wanted = clean(file);
    const current = here.get(wanted);
    const replace = choice === "replace" && current !== undefined;
    const name = replace ? wanted : freeName(wanted, taken);
    taken.add(name);
    opts.status(
      `Encrypting and uploading ${i + 1} of ${files.length}: ${name}`,
    );
    try {
      await ns.files.write(
        joinPath(folder, name),
        new Uint8Array(await file.arrayBuffer()),
        {
          mime: file.type || undefined,
          mtime: file.lastModified || undefined,
          // A compare-and-swap either way: never overwrite a version this
          // device has not seen (someone else's edit meanwhile).
          ...(replace ? { ifRev: current.rev } : { ifAbsent: true }),
        },
      );
      done++;
      if (replace) replaced++;
    } catch (err) {
      toast(
        (err as Error).name === "FileConflictError"
          ? `${name} changed on another device meanwhile; it was not replaced.`
          : `${name}: ${explain(err)}`,
        "fail",
      );
    }
  }
  opts.status(null);
  if (done)
    toast(
      `Uploaded ${done} file${done === 1 ? "" : "s"}${replaced ? ` (${replaced} replaced; the earlier version${replaced === 1 ? " is" : "s are"} kept)` : ""}`,
      "ok",
    );
  return done;
}
