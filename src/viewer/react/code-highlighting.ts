import hljs from "highlight.js";

export interface HighlightedCodeBlock {
  lines: string[];
  language: string | null;
}

const LANGUAGE_ALIASES: Array<{ pattern: RegExp; language: string }> = [
  { pattern: /^(c\+\+|gnu\+\+|clang\+\+)/, language: "cpp" },
  { pattern: /^c(11|17|23)?(?:\s|$)/, language: "c" },
  { pattern: /^(pypy|python)/, language: "python" },
  { pattern: /^java/, language: "java" },
  { pattern: /^kotlin/, language: "kotlin" },
  { pattern: /^rust/, language: "rust" },
  { pattern: /^go(?:\s|$)/, language: "go" },
  { pattern: /^c#/, language: "csharp" },
  { pattern: /^swift/, language: "swift" },
  { pattern: /^(javascript|node\.js)/, language: "javascript" },
  { pattern: /^typescript/, language: "typescript" },
  { pattern: /^php/, language: "php" },
  { pattern: /^ruby/, language: "ruby" },
  { pattern: /^scala/, language: "scala" },
  { pattern: /^haskell/, language: "haskell" },
  { pattern: /^ocaml/, language: "ocaml" },
  { pattern: /^f#/, language: "fsharp" },
  { pattern: /^lua/, language: "lua" },
  { pattern: /^pascal/, language: "delphi" },
  { pattern: /^fortran/, language: "fortran" },
  { pattern: /^perl/, language: "perl" },
  { pattern: /^(bash|shell)/, language: "bash" },
  { pattern: /^r(?:\s|$)/, language: "r" },
  { pattern: /^sql/, language: "sql" },
  { pattern: /^text$/, language: "plaintext" },
];

export function highlightCodeBlock(code: string, bojLanguage: string): HighlightedCodeBlock {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const language = resolveHighlightLanguage(bojLanguage);

  if (!language) {
    return {
      lines: lines.map((line) => escapeHtml(line)),
      language: null,
    };
  }

  return {
    lines: lines.map((line) => highlightSingleLine(line, language)),
    language,
  };
}

function resolveHighlightLanguage(bojLanguage: string): string | null {
  const normalized = bojLanguage.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const candidate of LANGUAGE_ALIASES) {
    if (candidate.pattern.test(normalized) && hljs.getLanguage(candidate.language)) {
      return candidate.language;
    }
  }

  return hljs.getLanguage(normalized) ? normalized : null;
}

function highlightSingleLine(line: string, language: string): string {
  if (!line) {
    return "";
  }

  try {
    return hljs.highlight(line, {
      language,
      ignoreIllegals: true,
    }).value;
  } catch {
    return escapeHtml(line);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
