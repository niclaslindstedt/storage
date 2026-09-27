import { useState, type ReactNode } from "react";

// A tiny, deterministic highlighter (same output on server and client) for
// the languages the site shows: comments, strings, keywords and numbers.
const RULES: Record<string, [RegExp, string][]> = {
  ts: [
    [/\/\/[^\n]*/y, "c"],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y, "s"],
    [
      /\b(?:import|from|export|const|let|await|async|function|return|type|for|of|if|throw|new|try|finally|describe|it|expect)\b/y,
      "k",
    ],
    [/\b\d+(?:\.\d+)?\b/y, "n"],
  ],
  yaml: [
    [/#[^\n]*/y, "c"],
    [/"(?:\\.|[^"\\])*"/y, "s"],
    [/^[ \t-]*[A-Za-z_][\w-]*(?=:)/my, "k"],
  ],
  sh: [
    [/#[^\n]*/y, "c"],
    [/"(?:\\.|[^"\\])*"|'[^']*'/y, "s"],
    [/(?:^|(?<=\n))[a-z][\w-]*/y, "k"],
  ],
};

function highlight(code: string, lang: string): ReactNode[] {
  const rules = RULES[lang];
  if (!rules) return [code];
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  outer: while (i < code.length) {
    for (const [re, cls] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length > 0) {
        if (plain) out.push(plain);
        plain = "";
        out.push(
          <span key={i} className={`tok-${cls}`}>
            {m[0]}
          </span>,
        );
        i += m[0].length;
        continue outer;
      }
    }
    plain += code[i];
    i++;
  }
  if (plain) out.push(plain);
  return out;
}

export function CodeBlock(props: {
  code: string;
  lang?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <figure className="code">
      <figcaption>
        <span>{props.label ?? props.lang ?? ""}</span>
        <button type="button" onClick={copy} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre>
        <code>{highlight(props.code, props.lang ?? "")}</code>
      </pre>
    </figure>
  );
}
