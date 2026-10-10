/**
 * Syntax-only diagnostics for the file editor (red squiggles while typing).
 * ponytail: JS/TS family via the TypeScript parser (lazy chunk), JSON via JSON.parse.
 * Other languages return no diagnostics; add a parser per language when needed.
 */
export interface SyntaxDiagnostic {
  start: number;
  end: number;
  message: string;
}

const TS_FILE_BY_LANGUAGE: Record<string, string> = {
  ts: "f.ts",
  typescript: "f.ts",
  mts: "f.mts",
  cts: "f.cts",
  tsx: "f.tsx",
  js: "f.js",
  javascript: "f.js",
  mjs: "f.js",
  cjs: "f.js",
  jsx: "f.jsx",
};

export async function getSyntaxDiagnostics(
  code: string,
  language: string | undefined,
): Promise<SyntaxDiagnostic[]> {
  const key = (language ?? "").trim().toLowerCase();

  if (key === "json") {
    if (code.trim() === "") return [];
    try {
      JSON.parse(code);
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const position = /position (\d+)/.exec(message)?.[1];
      const start = Math.min(position ? Number(position) : code.length - 1, code.length);
      return [{ start: Math.max(0, start), end: Math.min(code.length, start + 1), message }];
    }
  }

  const fileName = TS_FILE_BY_LANGUAGE[key];
  if (!fileName) return [];

  const mod = await import("typescript");
  const ts = mod.default ?? mod;
  const { diagnostics } = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });

  const result: SyntaxDiagnostic[] = [];
  for (const diagnostic of diagnostics ?? []) {
    if (diagnostic.start === undefined) continue;
    let start = diagnostic.start;
    let end = Math.min(code.length, start + Math.max(1, diagnostic.length ?? 1));
    if (end <= start) {
      // EOF-style errors ("'}' expected") are zero-width: underline the last visible character.
      end = start;
      while (end > 0 && /\s/.test(code[end - 1]!)) end -= 1;
      start = Math.max(0, end - 1);
    }
    result.push({
      start,
      end,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    });
  }
  return result;
}
