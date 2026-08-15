/* The uncaught-report FORMAT divergence, in one place.
 *
 * When a program dies of an uncaught error, Node prints a V8 crash
 * report — the origin `<file>:<line>`, the offending source line, a caret
 * line, a blank line, `Name: message`, the `    at` frames, the error's
 * inspected own properties, and the `Node.js vX` footer — while a
 * scriptc-compiled binary prints ONE line: `Uncaught Name: message` (or
 * `Unhandled promise rejection: …` / `Unhandled 'error' event: …`, the
 * runtime's two other uncaught flavours). differential.test.ts has always
 * said that format is a documented divergence and exempted it, but the
 * exemption was keyed on the DECLARED exit code (`// @exit:`), so a
 * program that declares nothing and CRASHES ANYWAY on this host — 22
 * POSIX-shaped corpus programs do, on Windows — landed inside the byte
 * comparison and compared a V8 stack trace against one line. Keying it on
 * the OBSERVED report instead is what this module is for.
 *
 * It is a REDUCTION, not a skip. Both sides come back as
 *
 *     { pre, line }
 *
 * where `pre` is everything the program itself wrote to stderr before the
 * report (compared byte-for-byte, exactly as today) and `line` is the
 * error's `Name: message` (compared byte-for-byte too). Only the report
 * AROUND the error is dropped. A program whose compiled binary reports a
 * different error, a different message, or no error at all still fails —
 * five of those 22 do, and they are the point of the exercise.
 */

/** The uncaught flavours the runtime prints (scr_exception.c,
 * scr_async.c/scr_island.c, scr_child.c/scr_net.c/scr_dgram.c). Each is a
 * LABEL for how the throw escaped, which is exactly what Node spells in
 * the report header this reduction drops. */
const NATIVE_MARKERS = ["Uncaught ", "Unhandled promise rejection: ", "Unhandled 'error' event: "];

export interface UncaughtReport {
  /** Everything written to stderr BEFORE the report — the program's own output. */
  readonly pre: string;
  /** The error's `Name: message`, decorations removed. */
  readonly line: string;
}

/** Node's `Name: message` line, stripped of the two decorations its
 * REPORT adds that the error itself does not carry:
 *  - `<ref *1> ` — util.inspect's circular-reference marker, printed
 *    because the error object refers to itself (a spawnSync result does);
 *  - `Name [ERR_CODE]:` — the stack decoration Node builds from
 *    `err.code`. A `catch` block sees `err.name === "TypeError"` and
 *    `err.code` separately, and the compiled runtime prints the name.
 */
function undecorate(line: string): string {
  return line.replace(/^<ref \*\d+> /, "").replace(/^([A-Za-z_$][\w$]*) \[[A-Z0-9_]+\]:/, "$1:");
}

/** Node's stderr reduced, or null when it carries no uncaught report (in
 * which case the caller keeps the byte comparison). The report is located
 * by its CARET line — the only line in a V8 report that is nothing but
 * whitespace and `^` — whose two predecessors are the origin and the
 * source line. */
export function reduceNodeReport(stderr: Buffer): UncaughtReport | null {
  const lines = stderr.toString("utf8").replace(/\r\n/g, "\n").split("\n");
  const caret = lines.findIndex((l) => /^\s*\^+\s*$/.test(l));
  if (caret < 2) return null;
  let i = caret + 1;
  while (i < lines.length && lines[i] === "") i++;
  const rest = lines.slice(i);
  const frame = rest.findIndex((l) => /^\s+at /.test(l));
  const err = (frame >= 0 ? rest.slice(0, frame) : rest).join("\n").replace(/\n+$/, "");
  if (err === "") return null;
  return { pre: lines.slice(0, caret - 2).join("\n"), line: undecorate(err) };
}

/** The compiled binary's stderr reduced the same way: its LAST line is
 * the report, everything above it is the program's own output. Returns
 * null when the last line carries none of the runtime's markers — a
 * binary that exited without reporting at all reduces to nothing and the
 * comparison fails, which is the answer we want. */
export function reduceNativeReport(stderr: Buffer): UncaughtReport | null {
  const text = stderr.toString("utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
  if (text === "") return null;
  const lines = text.split("\n");
  const last = lines[lines.length - 1] ?? "";
  const marker = NATIVE_MARKERS.find((m) => last.startsWith(m));
  if (marker === undefined) return null;
  return { pre: lines.slice(0, -1).join("\n"), line: last.slice(marker.length) };
}

/** Does the ORACLE's own run on this host end in an uncaught report? The
 * gate for the reduced comparison: only a Node run that DIED can license
 * dropping the report, and only for a program that declared no exit code
 * of its own (`// @exit:` programs keep the historical stdout-only
 * contract). */
export function oracleCrashed(nodeExit: number, declaredExit: number, nodeStderr: Buffer): boolean {
  return declaredExit === 0 && nodeExit !== 0 && reduceNodeReport(nodeStderr) !== null;
}
