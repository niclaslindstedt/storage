// Markdown files are inlined as strings by the bundler (tsup loader "text")
// and by the Vitest plugin in vitest.config.ts.
declare module "*.md" {
  const text: string;
  export default text;
}

// The admin console UI, bundled by scripts/ui-bundle.ts (tsup plugin in the
// build, Vite plugin in tests).
declare module "*?bundle" {
  const ui: { js: string; css: string };
  export default ui;
}
