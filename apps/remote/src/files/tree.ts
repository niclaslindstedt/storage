// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Folders inside a shared folder. The server stores flat, encrypted paths;
// a folder is the part of a path before a "/". An empty folder is kept alive
// by a marker file nobody sees. Pure — the Files screen and the tests read it.

/** The file that keeps an otherwise empty folder in the listing. */
export const FOLDER_MARKER = ".folder";

export type Entry = { path: string; size: number; mtime: number };

export type FolderView<T extends Entry> = {
  folders: { name: string; path: string; files: number; bytes: number }[];
  files: (T & { name: string })[];
};

/** "a/b" + "c" → "a/b/c"; "" + "c" → "c". */
export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** "a/b/c" → "a/b"; "c" → "". */
export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** "a/b/c" → "c". */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Why a name cannot be a file or folder name, or null when it can. */
export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "Give it a name.";
  if (name !== name.trim()) return "Remove the spaces at the start or end.";
  if (name.includes("/")) return "A name cannot contain “/”.";
  if (name === "." || name === "..") return "That name is reserved.";
  if (name === FOLDER_MARKER) return "That name is reserved.";
  if ([...name].length > 200) return "Keep it under 200 characters.";
  return null;
}

/**
 * What one folder shows: its subfolders (with how many files and bytes each
 * holds, all the way down) and its own files, both sorted by name.
 */
export function folderView<T extends Entry>(
  entries: T[],
  folder: string,
): FolderView<T> {
  const prefix = folder ? `${folder}/` : "";
  const folders = new Map<string, { files: number; bytes: number }>();
  const files: (T & { name: string })[] = [];
  for (const e of entries) {
    if (!e.path.startsWith(prefix)) continue;
    const rest = e.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      if (rest !== FOLDER_MARKER) files.push({ ...e, name: rest });
      continue;
    }
    const name = rest.slice(0, slash);
    const f = folders.get(name) ?? { files: 0, bytes: 0 };
    if (baseName(rest) !== FOLDER_MARKER) {
      f.files++;
      f.bytes += e.size;
    }
    folders.set(name, f);
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  return {
    folders: [...folders]
      .map(([name, f]) => ({ name, path: joinPath(folder, name), ...f }))
      .sort(byName),
    files: files.sort(byName),
  };
}

/** A name not yet taken in `taken`: "photo.jpg" → "photo (2).jpg". */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The breadcrumb for a folder: [["Home",""], ["a","a"], ["b","a/b"]]. */
export function crumbs(folder: string): { name: string; path: string }[] {
  if (!folder) return [];
  const parts = folder.split("/");
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/"),
  }));
}
