// Shape of src/generated/sourceData.ts, written by
// scripts/extract-source-data.mjs. The extractor and the components meet
// here, so a renamed field fails `npm run typecheck`.

export type Command = {
  name: string;
  summary: string;
  usage: string;
  examples: { cmd: string; note: string }[];
};

export type Setting = {
  flag: string;
  env: string;
  config: string | null;
  default: string | null;
  description: string;
};

export type Doc = {
  slug: string;
  title: string;
  summary: string;
  headings: { id: string; text: string }[];
  /** Distinct lower-case words of the body, for the docs search. */
  terms: string;
  wordCount: number;
  published: string;
  modified: string;
  source: string;
};

export type Example = {
  slug: string;
  title: string;
  summary: string;
  file: string;
  lang: string;
  code: string;
  source: string;
};

export type SourceData = {
  generatedFrom: string;
  version: string;
  license: string;
  node: string;
  repo: string;
  bin: string;
  lastUpdated: string;
  protocol: number;
  capabilities: string[];
  tlsModes: string[];
  defaults: {
    port: number;
    adminPort: number;
    tls: string;
    maxBodyBytes: number;
  };
  commands: Command[];
  settings: Setting[];
  docs: Doc[];
  examples: Example[];
  release: { version: string; date: string; html: string } | null;
};

export type DocBodies = Record<string, string>;
