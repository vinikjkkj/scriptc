/* `yield*` FORWARDS .return() TO THE DELEGATE -- a PARITY test against Node.
 *
 * This file used to pin the opposite: a deliberate divergence in which closing
 * an outer generator suspended inside `yield* inner()` unwound only the outer,
 * so the delegate's `finally` never ran (lower-generators.ts, "numbered
 * divergence"). That divergence is closed: the forwarding loop now closes the
 * delegate in a finally, hands a throw() to the delegate, and re-yields a
 * value the delegate yields from its own finally (corpus 24408 and 24409 pin
 * the throw and finally-yield arms against Node as well).
 *
 * The rows are the original ones, with the expectation moved to Node's answer
 * (the file name keeps its history; the old divergence record is in git). The
 * control stays: without it, "the delegate's finally ran" could mean a
 * generator finally that runs for another reason.
 *
 * It lives in tests/harness and not in tests/corpus because it builds with the
 * LLVM backend on purpose and asserts the Node output literally, per row.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/* The delegate records whether it was closed. That recording IS the control
 * surface: forwarding and not-forwarding differ by exactly this one value,
 * so the test can only pass for the right reason if the recording works --
 * which is what the control case below establishes separately. */
const INNER = [
  "let innerClosed = false",
  "",
  "function* inner(): Generator<number, number, undefined> {",
  "  try {",
  "    yield 1",
  "    yield 2",
  "    return 0",
  "  } finally {",
  "    innerClosed = true",
  "  }",
  "}",
  "",
].join("\n");

/** The SUBJECT: close the outer while it is suspended inside the delegate. */
const SUBJECT = INNER + [
  "function* outer(): Generator<number, number, undefined> {",
  "  yield* inner()",
  "  return 0",
  "}",
  "",
  "const g = outer()",
  "console.log(g.next().value)",
  "console.log(g.next().value)",
  "const r = g.return(99)",
  "console.log(r.done)",
  "console.log(r.value)",
  "console.log(innerClosed)",
  "",
].join("\n");

/** The CONTROL: close the delegate DIRECTLY, with no delegation involved.
 *
 * Without this, `innerClosed === false` in the subject is ambiguous -- it
 * could mean "the close was not forwarded" (the divergence) or "a
 * generator's finally never runs on .return() here at all" (a different and
 * much larger bug). The control separates them, and it can genuinely fail:
 * if generator finallys were broken, this is what would go red. */
const CONTROL = INNER + [
  "const d = inner()",
  "console.log(d.next().value)",
  "d.return(0)",
  "console.log(innerClosed)",
  "",
].join("\n");

function writeProgram(stem: string, src: string): { dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), `scriptc-yieldstar-${stem}-`));
  const entry = join(dir, `${stem}.ts`);
  writeFileSync(entry, src);
  return { dir, entry };
}

/** Build with scriptc and run the binary.
 *
 * THE LANE IS PINNED, AND IT IS PINNED TO LLVM ON PURPOSE. This file's
 * claim is scriptc against NODE on the semantics of a .return() through a
 * yield* delegation, and LLVM is the backend that ships -- so it is the
 * right lane for this claim, and inheriting the default would merely have
 * been the right answer by accident.
 *
 * AND THIS TEST CANNOT SEE THE STACKLESS LOWERING -- BUT NOT FOR THE REASON
 * THAT USED TO BE WRITTEN HERE. The sentence was "the stackless plan map is
 * consulted in zero of the LLVM backend's ten files and index.ts gates it on
 * backend === 'c'". Both halves died with the LLVM port: backend/llvm's
 * emitter.ts, coro.ts and blocks.ts all read the plan now, and index.ts's
 * `backend === "c"` is one arm of a ternary, not a gate on the lowering.
 *
 * What is still true is NARROWER and measured rather than structural: these
 * two programs are not ADMITTED. MEASURED 2026-10-10 on the SUBJECT, both
 * arms, reading the emitted .ll -- knob absent and SCRIPTC_STACKLESS=0 agree
 * that neither `inner` nor `outer` converts, and no `sc_S1` dispatch label
 * appears at all. A `yield*` delegation has no plan today. That is a fact
 * about the admission predicate, so it can change under this file without
 * anything here moving; the structural reason could not. Saying so is not a
 * caveat, it is the point: the sibling parity guard spent a whole run
 * reporting nine greens from
 * programs that had compiled through this very lane, and the only reason
 * that was caught is that two instruments counted what they had actually
 * built. A test that cannot fail for a reason must name the reason, or the
 * next reader counts it as coverage -- the same discipline as the
 * async-generator guard at emitter.ts, which says in its own comment that
 * it cannot fire today.
 *
 * If this file is ever wanted as a check on the STACKLESS lowering, that is
 * a different test: backend "c", the knob set per build, and a conversion
 * count asserted in the same run. */
async function scriptcOutput(stem: string, src: string): Promise<string> {
  const { dir, entry } = writeProgram(stem, src);
  const result = await compile(entry, {
    outPath: join(dir, exeName(stem)),
    outDir: dir,
    sanitize,
    backend: "llvm",
  });
  expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
  if (!result.ok) return "";
  const { stdout } = await execFileAsync(result.binaryPath);
  return stdout;
}

/** The other side of the divergence: the same source under Node itself. */
async function nodeOutput(stem: string, src: string): Promise<string> {
  const { entry } = writeProgram(stem, src);
  const { stdout } = await execFileAsync(process.execPath, [entry]);
  return stdout;
}

const lines = (s: string): string[] => s.split("\n").map((l) => l.replace("\r", "")).filter((l) => l.length > 0);

test("CONTROL: a direct .return() on a generator DOES run its finally", async () => {
  /* Establishes that the recording surface works at all, in both worlds.
   * A failure here invalidates the divergence test below rather than
   * revealing a divergence. */
  const got = lines(await scriptcOutput("control", CONTROL));
  expect(got).toEqual(["1", "true"]);
  expect(lines(await nodeOutput("control-node", CONTROL))).toEqual(["1", "true"]);
});

test("`yield*` forwards .return() to the delegate, as Node does", async () => {
  const got = lines(await scriptcOutput("subject", SUBJECT));
  /* The outer closes, the delegate's finally runs (innerClosed true), and the
   * return value is the consumer's. */
  expect(got).toEqual(["1", "2", "true", "99", "true"]);
});

test("PARITY with NODE on every observable of the delegated close", async () => {
  /* Pinning both sides keeps the file a comparison and not a snapshot: the
   * expectation is Node's literal answer and scriptc must equal it line for
   * line. */
  const mine = lines(await scriptcOutput("subject-pair", SUBJECT));
  const theirs = lines(await nodeOutput("subject-pair-node", SUBJECT));

  expect(theirs).toEqual(["1", "2", "true", "99", "true"]);
  expect(mine).toEqual(theirs);
});
