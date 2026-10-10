/* `yield*` DOES NOT CLOSE THE DELEGATE -- a known, deliberate divergence
 * from Node, pinned here so it cannot change by accident.
 *
 * READ THIS BEFORE "FIXING" A RED FROM THIS FILE. These tests assert what
 * scriptc DOES today, not what it SHOULD do. The divergence is documented at
 * packages/compiler/src/frontend/lowering/lower-generators.ts:666:
 *
 *     Consumer `.return()`/`.throw()` while suspended here unwinds the OUTER
 *     generator without forwarding to the delegate (numbered divergence).
 *
 * Node forwards: `outer.return(v)` while suspended inside `yield* inner()`
 * calls `inner.return(v)`, which runs the delegate's `finally`. scriptc
 * unwinds only the outer generator, so the delegate's `finally` never runs.
 *
 * If this file goes red because someone implemented forwarding, THAT IS THE
 * SIGNAL AND IT IS WORKING. Record the change, move the expectation, and say
 * so in the commit. Do not quietly edit the expected value to match new
 * behaviour: a test whose expectation follows the code cannot detect a
 * change in the code.
 *
 * WHY IT EXISTS AT ALL, AND WHY NOW. The stackless-async front is going to
 * rebuild the generator lowering (see docs/stackless-generators.md). Nothing
 * in this repository asserted this behaviour -- a search for the specific
 * shape came back empty -- which meant a rewritten unwind path could change
 * the divergence's CHARACTER while every gate stayed green. The recorded
 * position on that decision is "preserve exactly" (docs/stackless-generators.md
 * S10b, decision 6, logged OPEN), and a position with no instrument behind it
 * is a claim that cannot fail. This is the instrument, written while the
 * FIBER LANE IS STILL THE ORACLE -- which is the cheapest it will ever be,
 * because after the lowering moves there is nothing left to anchor against.
 *
 * It lives in tests/harness and not in tests/corpus for one reason: the
 * corpus scores against Node, and this program is DEFINED by not matching
 * Node. A corpus fixture would be permanently red.
 *
 * MEASURED, both arms, 2026-10-06. The scriptc expectations below were
 * originally DERIVED from reading the desugar and the runtime, with the node
 * side measured. Both arms have now been run:
 *
 *     control  scriptc  1 / true                 node  1 / true
 *     subject  scriptc  1 / 2 / true / 99 / FALSE node  1 / 2 / true / 99 / TRUE
 *
 * The reading predicted every value exactly. Host: node v25.9.0, zig 0.15.2,
 * SCRIPTC_TARGET=x86_64-windows-gnu, knob absent (the fiber lane).
 *
 * And the assertions were shown able to FAIL: replacing each expected array
 * with a sentinel reddened both tests and printed the arrays above as the
 * received values. A pinning test that has never been seen to fail is not
 * evidence, and the scriptc output differing from node's on exactly one line
 * is also what proves the binary ran at all rather than the node arm being
 * compared with itself.
 *
 * WHAT IS SPECIFICALLY NOT ASSERTED. Only the `.return()` arm is pinned.
 * The `.throw()` arm of the same sentence is left alone deliberately rather
 * than forgotten: a `.throw()` into an outer generator suspended in a
 * delegate has a second observable (where the exception surfaces) that this
 * file has not measured, and guessing it would plant a wrong expectation,
 * which is worse here than planting none.
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

test("DIVERGENCE: `yield*` does not forward .return() to the delegate", async () => {
  const got = lines(await scriptcOutput("subject", SUBJECT));
  /* scriptc: the outer unwinds, the delegate is dropped suspended, and its
   * finally never runs -- lower-generators.ts:666. */
  expect(got).toEqual(["1", "2", "true", "99", "false"]);
});

test("DIVERGENCE is against NODE, and differs in exactly one observable", async () => {
  /* Pinning both sides is what makes this a divergence record rather than a
   * snapshot: it states what Node does, what scriptc does, and that the gap
   * is one line and not a general disagreement about generators. If the gap
   * ever widens, this fails even when the two tests above still pass. */
  const mine = lines(await scriptcOutput("subject-pair", SUBJECT));
  const theirs = lines(await nodeOutput("subject-pair-node", SUBJECT));

  expect(theirs).toEqual(["1", "2", "true", "99", "true"]);
  expect(mine).toEqual(["1", "2", "true", "99", "false"]);

  const differing = mine
    .map((l, i) => (l === theirs[i] ? -1 : i))
    .filter((i) => i >= 0);
  expect(mine.length).toBe(theirs.length);
  expect(differing).toEqual([4]); // the delegate-closed observable, and only it
});
