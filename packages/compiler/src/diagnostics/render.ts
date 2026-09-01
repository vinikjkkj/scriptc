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

/* The line-start index of one source, built ONCE per lookup object.
 *
 * It used to be rebuilt PER DIAGNOSTIC: a `source.text[i] === "\n"` loop
 * over the whole file, then `source.text.split("\n")`, then a LINEAR scan
 * for the line — three passes over the entire source for every diagnostic
 * rendered against it. On an ordinary file that is invisible. On the input
 * this compiler is actually asked to swallow it is not: zapo's
 * `spec/proto/index.js` is 1,867,556 bytes of minified JavaScript on ONE
 * line, and a build that refuses N statements inside it walked O(N x 1.87 MB)
 * three times over before printing anything.
 *
 * Keyed on the SourceLookup OBJECT rather than on the text, so the cache can
 * never pin a megabyte of source alive by itself; renderAll hands every
 * diagnostic of a file the same lookup object, which is what makes the memo
 * bite. The emitter's own srcSite() has had this shape — cached index plus
 * binary search — since it was written; this is the diagnostics side
 * catching up.
 *
 * Output is byte-identical: `lineStarts.length` equals
 * `text.split("\n").length` for every string, and lineAt() below reproduces
 * that array's elements exactly. */
const lineIndexCache = new WeakMap<SourceLookup, number[]>();

function lineStartsOf(source: SourceLookup): number[] {
  const hit = lineIndexCache.get(source);
  if (hit !== undefined) return hit;
  const starts = [0];
  const text = source.text;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  lineIndexCache.set(source, starts);
  return starts;
}

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
    const text = source.text;
    const lineStarts = lineStartsOf(source);
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= diag.loc.start) lo = mid;
      else hi = mid - 1;
    }
    lineNum = lo + 1;
    colNum = diag.loc.start - lineStarts[lo]! + 1;

    /* The nth line's text, WITHOUT materialising the other n-1. Identical
     * to `text.split("\n")[n - 1]`: the slice stops one character before
     * the next line's start, which drops that "\n" and keeps any "\r"
     * in front of it; the last line runs to the end of the file. */
    const lineAt = (n: number): string | undefined => {
      if (n < 1 || n > lineStarts.length) return undefined;
      const from = lineStarts[n - 1]!;
      const next = lineStarts[n];
      return next === undefined ? text.slice(from) : text.slice(from, next - 1);
    };
    const gutterWidth = String(Math.min(lineNum + 1, lineStarts.length)).length;
    const emitLine = (n: number) => {
      const t = lineAt(n);
      if (t === undefined) return;
      frame.push(c(DIM, `  ${String(n).padStart(gutterWidth)} | `) + t);
    };
    emitLine(lineNum - 1);
    emitLine(lineNum);
    const lineText = lineAt(lineNum) ?? "";
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
  // One lookup object per FILE, not per diagnostic: the line index above is
  // memoized on that object, so N diagnostics in one file build the index
  // once between them instead of N times.
  const lookups = new Map<string, SourceLookup>();
  const lookupFor = (file: string): SourceLookup | undefined => {
    const hit = lookups.get(file);
    if (hit !== undefined) return hit;
    const text = sourceTextByFile.get(file);
    if (text === undefined) return undefined;
    const made: SourceLookup = { text };
    lookups.set(file, made);
    return made;
  };
  return sorted
    .map((d) => renderDiagnostic(d, lookupFor(d.loc.file), opts))
    .join("\n\n");
}
