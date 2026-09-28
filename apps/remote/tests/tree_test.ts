import { describe, expect, it } from "vitest";

import {
  baseName,
  crumbs,
  FOLDER_MARKER,
  folderView,
  freeName,
  joinPath,
  nameProblem,
  parentOf,
} from "../src/files/tree.ts";

const e = (path: string, size = 10) => ({ path, size, mtime: 0 });

describe("folderView", () => {
  const entries = [
    e("notes.txt", 5),
    e("Photos/2026/beach.jpg", 100),
    e("Photos/2026/sunset.jpg", 200),
    e("Photos/cat.jpg", 50),
    e("Empty/.folder", 0),
    e(".folder", 0),
    e("Photos10/a.txt"),
  ];

  it("lists the top level: folders with their totals, then files", () => {
    const v = folderView(entries, "");
    expect(v.folders).toEqual([
      { name: "Empty", path: "Empty", files: 0, bytes: 0 },
      { name: "Photos", path: "Photos", files: 3, bytes: 350 },
      { name: "Photos10", path: "Photos10", files: 1, bytes: 10 },
    ]);
    expect(v.files.map((f) => f.name)).toEqual(["notes.txt"]);
  });

  it("lists a nested folder and never shows the marker file", () => {
    const v = folderView(entries, "Photos");
    expect(v.folders.map((f) => f.path)).toEqual(["Photos/2026"]);
    expect(v.files.map((f) => f.name)).toEqual(["cat.jpg"]);
    expect(folderView(entries, "Empty")).toEqual({ folders: [], files: [] });
    expect(folderView([e(`a/${FOLDER_MARKER}`)], "").folders[0]?.files).toBe(0);
  });

  it("sorts names the way people count", () => {
    const v = folderView([e("file10"), e("file2"), e("file1")], "");
    expect(v.files.map((f) => f.name)).toEqual(["file1", "file2", "file10"]);
  });
});

describe("paths and names", () => {
  it("joins, splits and names", () => {
    expect(joinPath("", "a")).toBe("a");
    expect(joinPath("a/b", "c")).toBe("a/b/c");
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("c")).toBe("");
    expect(baseName("a/b/c")).toBe("c");
    expect(crumbs("a/b")).toEqual([
      { name: "a", path: "a" },
      { name: "b", path: "a/b" },
    ]);
    expect(crumbs("")).toEqual([]);
  });

  it("refuses names the path encoding cannot carry", () => {
    expect(nameProblem("report.pdf")).toBeNull();
    for (const bad of ["", " x", "a/b", ".", "..", FOLDER_MARKER])
      expect(nameProblem(bad)).not.toBeNull();
  });

  it("finds a free name for a duplicate upload", () => {
    const taken = new Set(["photo.jpg", "photo (2).jpg", "README"]);
    expect(freeName("photo.jpg", taken)).toBe("photo (3).jpg");
    expect(freeName("README", taken)).toBe("README (2)");
    expect(freeName("new.txt", taken)).toBe("new.txt");
    expect(freeName(".env", new Set([".env"]))).toBe(".env (2)");
  });
});
