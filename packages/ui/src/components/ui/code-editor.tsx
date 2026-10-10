"use client";

/**
 * Lightweight, dependency-free code editor used by the file preview pane.
 *
 * Features: line-number gutter (synced scroll), current-line highlight, Tab / Shift+Tab
 * (multi-line indent/outdent), auto-indent on Enter, Ctrl/Cmd+S to save, Ctrl/Cmd+D to
 * duplicate the line, Ctrl/Cmd+Shift+K to delete the line, Ctrl/Cmd+/ to toggle line
 * comments, Esc to leave edit mode, optional soft wrap.
 * Native undo/redo is preserved because edits go through `document.execCommand("insertText")`
 * when available.
 */
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, UIEvent } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { BundledTheme } from "shiki";

import { cn } from "@/components/lib/utils.js";
import { highlightCode, type TokenizedCode } from "@/lib/shikiHighlighter.js";
import { getSyntaxDiagnostics, type SyntaxDiagnostic } from "@/lib/syntaxDiagnostics.js";

export interface CodeEditorHandle {
  focus(): void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onEscape?: () => void;
  language?: string;
  /** Shiki theme for the live highlight layer; defaults to github-light/dark by app mode. */
  theme?: BundledTheme;
  fontSizePx?: number;
  wrapLongLines?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Number of spaces used for Tab when the file does not already indent with tabs. */
  tabSize?: number;
  className?: string;
  ariaLabel?: string;
}

const LINE_COMMENT_BY_LANGUAGE: Record<string, string> = {
  bash: "#",
  sh: "#",
  shell: "#",
  zsh: "#",
  python: "#",
  py: "#",
  ruby: "#",
  rb: "#",
  yaml: "#",
  yml: "#",
  toml: "#",
  dockerfile: "#",
  makefile: "#",
  perl: "#",
  r: "#",
  powershell: "#",
  ini: ";",
  sql: "--",
  lua: "--",
  haskell: "--",
  elm: "--",
  lisp: ";",
  clojure: ";",
  vim: '"',
  tex: "%",
  latex: "%",
  erlang: "%",
  matlab: "%",
};

function resolveLineComment(language?: string): string {
  const key = (language ?? "").toLowerCase();
  return LINE_COMMENT_BY_LANGUAGE[key] ?? "//";
}

function detectIndentUnit(value: string, tabSize: number): string {
  const lines = value.split("\n", 400);
  let tabs = 0;
  let spaces = 0;
  for (const line of lines) {
    if (line.startsWith("\t")) tabs += 1;
    else if (line.startsWith("  ")) spaces += 1;
  }
  return tabs > spaces ? "\t" : " ".repeat(tabSize);
}

function lineStartOf(value: string, index: number): number {
  return value.lastIndexOf("\n", index - 1) + 1;
}

function lineEndOf(value: string, index: number): number {
  const end = value.indexOf("\n", index);
  return end === -1 ? value.length : end;
}

/**
 * Replace a range while keeping the browser's native undo stack when possible.
 */
function replaceRange(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  selectionStart: number,
  selectionEnd: number,
  fallback: (next: string) => void,
) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let applied = false;
  try {
    applied =
      typeof document !== "undefined" &&
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, text);
  } catch {
    applied = false;
  }
  if (!applied) {
    const next = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    fallback(next);
    requestAnimationFrame(() => textarea.setSelectionRange(selectionStart, selectionEnd));
    return;
  }
  textarea.setSelectionRange(selectionStart, selectionEnd);
}

const SQUIGGLE_STYLE: CSSProperties = {
  textDecorationLine: "underline",
  textDecorationStyle: "wavy",
  textDecorationColor: "var(--color-destructive, #f14c4c)",
  textDecorationSkipInk: "none",
};

/** Colored tokens (from Shiki) with red squiggles over diagnostic ranges. */
function renderHighlight(
  tokens: TokenizedCode | null,
  diagnostics: readonly SyntaxDiagnostic[],
  value: string,
): ReactNode {
  if (!tokens) return value;
  const nodes: ReactNode[] = [];
  let offset = 0;
  tokens.tokens.forEach((line, lineIndex) => {
    line.forEach((token, tokenIndex) => {
      const text = token.content;
      const tokenStart = offset;
      const tokenEnd = offset + text.length;
      offset = tokenEnd;
      const base: CSSProperties | undefined = token.color ? { color: token.color } : undefined;
      const hits = diagnostics.filter((d) => d.start < tokenEnd && d.end > tokenStart);
      if (hits.length === 0) {
        nodes.push(
          <span key={`${lineIndex}-${tokenIndex}`} style={base}>
            {text}
          </span>,
        );
        return;
      }
      const cuts = new Set([tokenStart, tokenEnd]);
      for (const d of hits) {
        cuts.add(Math.max(d.start, tokenStart));
        cuts.add(Math.min(d.end, tokenEnd));
      }
      const points = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < points.length - 1; i += 1) {
        const from = points[i]!;
        const to = points[i + 1]!;
        const bad = hits.some((d) => d.start < to && d.end > from);
        nodes.push(
          <span
            key={`${lineIndex}-${tokenIndex}-${i}`}
            style={bad ? { ...base, ...SQUIGGLE_STYLE } : base}
          >
            {text.slice(from - tokenStart, to - tokenStart)}
          </span>,
        );
      }
    });
    if (lineIndex < tokens.tokens.length - 1) {
      nodes.push("\n");
      offset += 1;
    }
  });
  void value;
  return nodes;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    onSave,
    onEscape,
    language,
    theme,
    fontSizePx = 13,
    wrapLongLines = false,
    readOnly = false,
    autoFocus = true,
    tabSize = 2,
    className,
    ariaLabel,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [tokens, setTokens] = useState<TokenizedCode | null>(null);
  const [diagnostics, setDiagnostics] = useState<SyntaxDiagnostic[]>([]);

  // Live syntax highlighting. Keeps the previous tokens until the new ones arrive (no flash).
  useEffect(() => {
    let alive = true;
    const immediate = highlightCode(value, language ?? "", theme, (result) => {
      if (alive) setTokens(result);
    });
    if (immediate) setTokens(immediate);
    return () => {
      alive = false;
    };
  }, [value, language, theme]);

  // Live syntax errors, debounced so typing never waits on the parser.
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await getSyntaxDiagnostics(value, language);
        if (alive) setDiagnostics(next);
      } catch {
        if (alive) setDiagnostics([]);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [value, language]);

  const highlighted = useMemo(
    () => renderHighlight(tokens, diagnostics, value),
    [tokens, diagnostics, value],
  );
  const firstError = diagnostics[0];
  const firstErrorLine = firstError ? value.slice(0, firstError.start).split("\n").length : 0;

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  useEffect(() => {
    if (autoFocus) {
      const id = requestAnimationFrame(() => textareaRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [autoFocus]);

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) === 10) count += 1;
    return count;
  }, [value]);

  const indentUnit = useMemo(() => detectIndentUnit(value, tabSize), [value, tabSize]);
  const lineComment = useMemo(() => resolveLineComment(language), [language]);

  const updateCursor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const line = before.split("\n").length;
    setCursorLine(line);
    setCursorColumn(pos - lineStartOf(textarea.value, pos) + 1);
  }, []);

  const handleScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = event.currentTarget;
      const mod = event.metaKey || event.ctrlKey;
      const { selectionStart: start, selectionEnd: end } = textarea;
      const text = textarea.value;

      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave?.();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape?.();
        return;
      }
      if (readOnly) return;

      // Tab / Shift+Tab: indent or outdent (multi-line aware)
      if (event.key === "Tab" && !mod && !event.altKey) {
        event.preventDefault();
        const blockStart = lineStartOf(text, start);
        const multiLine = text.slice(start, end).includes("\n");
        if (!multiLine && !event.shiftKey) {
          replaceRange(
            textarea,
            start,
            end,
            indentUnit,
            start + indentUnit.length,
            start + indentUnit.length,
            onChange,
          );
          return;
        }
        const blockEnd = lineEndOf(text, end > start && text[end - 1] === "\n" ? end - 1 : end);
        const lines = text.slice(blockStart, blockEnd).split("\n");
        let firstDelta = 0;
        let totalDelta = 0;
        const nextLines = lines.map((line, index) => {
          if (event.shiftKey) {
            let removed = 0;
            if (line.startsWith("\t")) removed = 1;
            else {
              while (removed < indentUnit.length && line[removed] === " ") removed += 1;
            }
            if (index === 0) firstDelta = -removed;
            totalDelta -= removed;
            return line.slice(removed);
          }
          if (index === 0) firstDelta = indentUnit.length;
          totalDelta += indentUnit.length;
          return indentUnit + line;
        });
        const replacement = nextLines.join("\n");
        replaceRange(
          textarea,
          blockStart,
          blockEnd,
          replacement,
          Math.max(blockStart, start + firstDelta),
          end + totalDelta,
          onChange,
        );
        return;
      }

      // Enter: keep indentation of the current line (+1 level after an opening bracket/colon)
      if (event.key === "Enter" && !mod && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        const lineStart = lineStartOf(text, start);
        const currentLine = text.slice(lineStart, start);
        const indent = /^[\t ]*/.exec(currentLine)?.[0] ?? "";
        const trimmed = currentLine.trimEnd();
        const opensBlock = /[{[(:]$/.test(trimmed);
        const nextChar = text[end] ?? "";
        const closesBlock = opensBlock && /^[}\])]/.test(nextChar);
        const extra = opensBlock ? indentUnit : "";
        const insert = closesBlock
          ? `\n${indent}${extra}\n${indent}`
          : `\n${indent}${extra}`;
        const caret = start + 1 + indent.length + extra.length;
        replaceRange(textarea, start, end, insert, caret, caret, onChange);
        return;
      }

      // Ctrl/Cmd+Shift+K: delete current line(s)
      if (mod && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const blockStart = lineStartOf(text, start);
        let blockEnd = lineEndOf(text, end);
        if (blockEnd < text.length) blockEnd += 1;
        else if (blockStart > 0) {
          replaceRange(textarea, blockStart - 1, blockEnd, "", blockStart - 1, blockStart - 1, onChange);
          return;
        }
        replaceRange(textarea, blockStart, blockEnd, "", blockStart, blockStart, onChange);
        return;
      }

      // Ctrl/Cmd+D: duplicate current line(s)
      if (mod && !event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const blockStart = lineStartOf(text, start);
        const blockEnd = lineEndOf(text, end);
        const block = text.slice(blockStart, blockEnd);
        const offset = block.length + 1;
        replaceRange(
          textarea,
          blockEnd,
          blockEnd,
          `\n${block}`,
          start + offset,
          end + offset,
          onChange,
        );
        return;
      }

      // Ctrl/Cmd+/: toggle line comment
      if (mod && event.key === "/") {
        event.preventDefault();
        const blockStart = lineStartOf(text, start);
        const blockEnd = lineEndOf(text, end);
        const lines = text.slice(blockStart, blockEnd).split("\n");
        const marker = `${lineComment} `;
        const nonEmpty = lines.filter((line) => line.trim().length > 0);
        const allCommented =
          nonEmpty.length > 0 && nonEmpty.every((line) => line.trimStart().startsWith(lineComment));
        const nextLines = lines.map((line) => {
          if (line.trim().length === 0) return line;
          const indent = /^[\t ]*/.exec(line)?.[0] ?? "";
          const rest = line.slice(indent.length);
          if (allCommented) {
            if (rest.startsWith(marker)) return indent + rest.slice(marker.length);
            return indent + rest.slice(lineComment.length);
          }
          return indent + marker + rest;
        });
        const replacement = nextLines.join("\n");
        replaceRange(
          textarea,
          blockStart,
          blockEnd,
          replacement,
          blockStart,
          blockStart + replacement.length,
          onChange,
        );
      }
    },
    [indentUnit, lineComment, onChange, onEscape, onSave, readOnly],
  );

  const lineHeightPx = Math.round(fontSizePx * 1.6);
  const sharedStyle: CSSProperties = {
    fontFamily:
      'var(--font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace)',
    fontSize: `${fontSizePx}px`,
    lineHeight: `${lineHeightPx}px`,
    tabSize,
    // Ligatures would make the highlight layer wider than the textarea and drift the caret.
    fontVariantLigatures: "none",
  };

  const gutterDigits = Math.max(2, String(lineCount).length);

  return (
    <div className={cn("flex h-full w-full flex-col bg-background", className)}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {!wrapLongLines ? (
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="shrink-0 select-none overflow-hidden border-r border-border bg-surface/30 py-2 pr-2 pl-3 text-right text-foreground-subtlest"
            style={{ ...sharedStyle, minWidth: `${gutterDigits + 2}ch` }}
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <div
                key={index}
                className={cn(index + 1 === cursorLine && "text-foreground")}
                style={{ height: `${lineHeightPx}px` }}
              >
                {index + 1}
              </div>
            ))}
            {/* spacer so the gutter can scroll as far as the textarea */}
            <div style={{ height: "50vh" }} />
          </div>
        ) : null}
        <div className="relative min-h-0 min-w-0 flex-1">
          <pre
            ref={highlightRef}
            aria-hidden="true"
            data-testid="code-editor-highlight"
            className={cn(
              "pointer-events-none absolute inset-0 m-0 overflow-auto border-0 px-3 py-2 text-foreground",
              wrapLongLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            )}
            style={{ ...sharedStyle, paddingBottom: "50vh" }}
          >
            {highlighted}
          </pre>
          <textarea
            ref={textareaRef}
            aria-label={ariaLabel ?? "Code editor"}
            data-testid="code-editor-textarea"
            className={cn(
              "absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent px-3 py-2 text-transparent caret-foreground outline-none selection:bg-foreground/20",
              wrapLongLines ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            )}
            style={{ ...sharedStyle, paddingBottom: "50vh" }}
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap={wrapLongLines ? "soft" : "off"}
            onChange={(event) => {
              onChange(event.target.value);
              updateCursor();
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onSelect={updateCursor}
            onScroll={handleScroll}
          />
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-border bg-surface/30 px-3 text-ui-sm text-foreground-subtle">
        {firstError ? (
          <span className="mr-auto min-w-0 truncate text-destructive" title={firstError.message}>
            {diagnostics.length} {diagnostics.length === 1 ? "error" : "errors"} · Ln {firstErrorLine}:{" "}
            {firstError.message}
          </span>
        ) : null}
        <span>
          Ln {cursorLine}, Col {cursorColumn}
        </span>
        <span>{indentUnit === "\t" ? "Tabs" : `Spaces: ${indentUnit.length}`}</span>
        {language ? <span>{language}</span> : null}
      </div>
    </div>
  );
});
