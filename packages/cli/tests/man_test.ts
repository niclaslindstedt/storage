// The committed man/storage/*.md pages equal the rendered registry, and
// every flag the parser knows is documented.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderMan, renderManIndex } from "../src/render.ts";
import { COMMANDS, ENV_VARS, GLOBAL_FLAGS } from "../src/spec.ts";

const dir = join(__dirname, "..", "..", "..", "man", "storage");

describe("manual pages", () => {
  it("are committed and up to date (run `make man`)", () => {
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(renderManIndex());
    for (const c of COMMANDS) {
      const file = join(dir, `${c.name}.md`);
      expect(existsSync(file), `man/storage/${c.name}.md`).toBe(true);
      expect(
        readFileSync(file, "utf8"),
        `man/storage/${c.name}.md is stale`,
      ).toBe(renderMan(c));
    }
    expect(readdirSync(dir).sort()).toEqual(
      ["README.md", ...COMMANDS.map((c) => `${c.name}.md`)].sort(),
    );
  });

  it("document every flag and environment variable", () => {
    for (const c of COMMANDS) {
      const page = renderMan(c);
      for (const f of [
        ...(c.flags ?? []),
        ...(c.subcommands ?? []).flatMap((s) => s.flags),
        ...GLOBAL_FLAGS,
      ])
        expect(page, `${c.name} --${f.name}`).toContain(`--${f.name}\``);
    }
    const index = renderManIndex();
    for (const e of ENV_VARS) expect(index).toContain(`\`${e.name}\``);
  });
});
