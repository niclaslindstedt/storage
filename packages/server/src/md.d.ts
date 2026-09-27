// Markdown files are inlined as strings by the bundler (tsup loader "text")
// and by the Vitest plugin in vitest.config.ts.
declare module "*.md" {
  const text: string;
  export default text;
}
