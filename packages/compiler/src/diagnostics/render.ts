/* Terminal rendering: file:line:col, a hand-rolled code frame with ±1 line
 * of context and a ^~~~ underline sized to the span, optional hint line,
 * and the optional attributed profile-note line after it.
 */
import type { ScrDiagnostic } from "./diagnostic.js";

export interface RenderOptions {
  color?: boolean;
}

interface SourceLookup {
  /** Full text of the file the diagnostic points into. */
  text: string;
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function renderDiagnostic(
  diag: ScrDiagnostic,
  source: SourceLookup | undefined,
  opts: RenderOptions = {},
): string {
  const c = (code: string, s: string) => (opts.color ? code + s + RESET : s);
  const out: string[] = [];
  // ADVICE (SC6xxx) is not a refusal: the build succeeded and this says
  // something true about what it compiled to. It reads through the same
  // renderer — same span, same frame, same hint — with the one word and
  // the one colour that decide how a reader files it.
  const isAdvice = diag.severity === "advice";
  const label = isAdvice ? c(YELLOW, "advice") : c(RED, "error");
  const mark = isAdvice ? YELLOW : RED;

  let lineNum = 1;
  let colNum = 1;
  const frame: string[] = [];

  if (source) {
    const lineStarts = [0];
    for (let i = 0; i < source.text.length; i++) {
      if (source.text[i] === "\n") lineStarts.push(i + 1);
    }
    let lo = 0;
    while (lo + 1 < lineStarts.length && lineStarts[lo + 1]! <= diag.loc.start) lo++;
    lineNum = lo + 1;
    colNum = diag.loc.start - lineStarts[lo]! + 1;

    const lines = source.text.split("\n");
    const gutterWidth = String(Math.min(lineNum + 1, lines.length)).length;
    const emitLine = (n: number) => {
      const text = lines[n - 1];
      if (text === undefined) return;
      frame.push(c(DIM, `  ${String(n).padStart(gutterWidth)} | `) + text);
    };
    emitLine(lineNum - 1);
    emitLine(lineNum);
    const lineText = lines[lineNum - 1] ?? "";
    const spanOnLine = Math.max(
      1,
      Math.min(diag.loc.end - diag.loc.start, lineText.length - (colNum - 1)),
    );
    frame.push(
      c(DIM, `  ${" ".repeat(gutterWidth)} | `) +
        " ".repeat(colNum - 1) +
        c(mark, "^" + "~".repeat(spanOnLine - 1)),
    );
    emitLine(lineNum + 1);
  }

  out.push(
    `${c(BOLD, `${diag.loc.file}:${lineNum}:${colNum}`)} - ${label} ${c(BOLD, diag.code)}: ${diag.message}`,
  );
  if (frame.length) {
    out.push("", ...frame);
  }
  if (diag.hint) {
    out.push("", `  ${c(CYAN, "hint:")} ${diag.hint}`);
  }
  if (diag.note) {
    // Embedder-authored teaching text: its own attributed trailing line
    // (the text itself begins "from the '<profile>' profile:"), so the
    // tool's message and hint stay visibly the tool's.
    if (!diag.hint) out.push("");
    out.push(`  ${c(CYAN, "note:")} ${diag.note}`);
  }
  return out.join("\n");
}

export function renderAll(
  diags: ScrDiagnostic[],
  sourceTextByFile: Map<string, string>,
  opts: RenderOptions = {},
): string {
  const sorted = [...diags].sort(
    (a, b) => a.loc.file.localeCompare(b.loc.file) || a.loc.start - b.loc.start,
  );
  return sorted
    .map((d) => {
      const text = sourceTextByFile.get(d.loc.file);
      return renderDiagnostic(d, text === undefined ? undefined : { text }, opts);
    })
    .join("\n\n");
}
