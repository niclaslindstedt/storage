// Bundle the admin console UI (src/admin/ui, vanilla TypeScript + CSS) into
// strings the server serves as /app.js and /app.css. Source files import it
// as `import ui from "./ui/main.ts?bundle"`; this module provides the same
// transform for tsup (esbuild plugin) and Vitest (Vite plugin), so tests run
// the real UI code and the published server has no runtime dependency.

import { dirname, resolve } from "node:path";

import { build, type Plugin as EsbuildPlugin } from "esbuild";

export type UiBundle = { js: string; css: string };

const SUFFIX = "?bundle";

export async function bundleUi(
  entry: string,
  opts: { minify?: boolean } = {},
): Promise<UiBundle & { inputs: string[] }> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: "out",
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: opts.minify ?? true,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
  });
  const pick = (ext: string) =>
    result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? "";
  return {
    js: pick(".js"),
    css: pick(".css"),
    inputs: Object.keys(result.metafile.inputs).map((p) => resolve(p)),
  };
}

const moduleSource = (ui: UiBundle) =>
  `export default ${JSON.stringify({ js: ui.js, css: ui.css })};`;

/** For tsup / esbuild. */
export function esbuildUiPlugin(): EsbuildPlugin {
  return {
    name: "ui-bundle",
    setup(b) {
      b.onResolve({ filter: /\?bundle$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.slice(0, -SUFFIX.length)),
        namespace: "ui-bundle",
      }));
      b.onLoad({ filter: /.*/, namespace: "ui-bundle" }, async (args) => {
        const ui = await bundleUi(args.path);
        return {
          contents: moduleSource(ui),
          loader: "js",
          watchFiles: ui.inputs,
        };
      });
    },
  };
}

/** For Vitest / Vite (unminified, so failures point at readable code). */
export function viteUiPlugin() {
  const PREFIX = "\0ui-bundle:";
  return {
    name: "ui-bundle",
    enforce: "pre" as const,
    resolveId(id: string, importer?: string) {
      if (!id.endsWith(SUFFIX) || !importer) return null;
      return PREFIX + resolve(dirname(importer), id.slice(0, -SUFFIX.length));
    },
    async load(id: string) {
      if (!id.startsWith(PREFIX)) return null;
      return moduleSource(
        await bundleUi(id.slice(PREFIX.length), { minify: false }),
      );
    },
  };
}
