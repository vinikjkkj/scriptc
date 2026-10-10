/* THE TWO CROSS-PARK SHAPES THE LLVM LANE REFUSED, EXERCISED END TO END.
 *
 * WHY A SEPARATE FILE. stackless-values.test.ts guards the PAYLOAD KINDS an
 * await carries; neither shape below is a payload kind, and both were refused
 * by the LLVM emitter while that file stayed green -- which is the whole
 * reason a green suite could coexist with nine functions on the fiber lane in
 * the shipping build. A suite that cannot report a REFUSAL cannot referee a
 * change that removes one.
 *
 * MEASURED, on tests/perf/zapo-rest/app182 at main 45907e6dd with
 * SCRIPTC_LLVM_CORO_CENSUS=1: 1476 lowered of 1485 planned, and all nine
 * refusals were one of these two shapes -- the SHAPE, not the census label,
 * which is the distinction the numbers below are arranged around.
 *
 *   SHAPE A -- a value produced by an INDIRECT call crosses a park.
 *     `%t174 = call ptr %t173(ptr %t167, ptr %t171)` is an ordinary closure or
 *     virtual dispatch. llResultType read the callee position for a literal
 *     `@`, found `%t173`, and answered null -- and a null llType is not a
 *     spill, it is a refusal of the whole FUNCTION.
 *
 *   SHAPE B -- a park INSIDE a for-of.
 *     The loop's cursor and iterable are machine-stack memory of the resume
 *     call and are re-entered through the back edge, so the lowering DEMANDS
 *     them in the frame rather than waiting for the append-order scan. That
 *     demand was the one cross-park rule in the backend with no collector arm,
 *     so it made probeCoroViolations' first pass throw; the probe declines on
 *     any throw, the body then reached the discovery loop with EMPTY seeds,
 *     and bodies ran out at CORO_SPILL_PASS_CAP with their slot sets still
 *     growing.
 *
 * THE SPLIT IS 5 / 3 / 1, MEASURED PER ARM AND NOT DERIVED. Each repair was
 * built alone and app182 re-censused:
 *
 *   shape-A reader alone  1481 of 1485 -- closes %m143.WaComms.onDecodedFrame,
 *     %m221.WaNodeTransport.dispatchIncomingFrame,
 *     %m224.WaMobileCoordinator.persist, %m277.WaClientImpl.clearStoredState,
 *     %fn53
 *   shape-B collector alone  1479 of 1485 -- closes
 *     %m67.handleIncomingMessageAck, %m69.settleHistorySyncChunk,
 *     %m191.WaIncomingNodeCoordinator.dispatchIncomingNode
 *   both  1485 of 1485
 *
 * 5 + 3 = 8, and the ninth is the reason the arms were measured separately:
 * %fn778 refuses under EITHER repair alone and converts only under both. The
 * labels are no guide to the split either -- %m277.WaClientImpl.clearStoredState
 * was censused `cross-park-temp-promote-passes>12` and is closed by the TYPE
 * reader, because the cap stopped its discovery loop before it ever reached
 * the four untyped temps the probe had already seen in it.
 *
 * WHAT THIS FILE ASSERTS, and the two claims are independent.
 *
 *   1. THE SHAPES CONVERT. Each body must have a resume function in the
 *      stackless artifact, BY NAME. This is the half that can go red: with
 *      either repair reverted the matching body is refused, emits no
 *      `sc_cr_`, and falls back to a fiber -- and the output comparison below
 *      stays GREEN, because a refusal makes the two arms MORE equal, not less.
 *      Output alone would referee nothing here.
 *
 *   2. THE SHAPES ARE STILL RIGHT. A conversion that carries the wrong value
 *      across the park is worse than a refusal. Both arms are run and their
 *      stdout compared, and the fiber arm is checked against literal expected
 *      text first, so a lane that was itself broken cannot referee the other.
 *
 * BOTH LANES, for the reason stackless-values runs on both: the shapes are not
 * LLVM-specific, only the refusal was. The C lane converting them before and
 * after is the negative control for claim 1 -- an assertion that is green on
 * one lane whatever the repair does, and red on the other without it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

type Lane = "c" | "llvm";

/* BOTH SHAPES ARE SPELLED THE WAY THE EMITTER ACTUALLY REACHES THEM, and the
 * first draft of this file got both wrong in the direction that passes.
 *
 * SHAPE A NEEDS AN SSA TEMP, NOT A NAMED LOCAL. `const joined = f(a, b);` then
 * `await` then `joined` does NOT reach the cross-park temp rule at all: a
 * declared local is an alloca the frame already carries by name
 * (`store ptr %t16, ptr %sc_l_joined_0`), so the call's result never crosses
 * as a `%tN`. The value has to stay a TEMPORARY across the park, which is what
 * `f(a, b) + (await g())` does -- measured in the emitted module, the carry is
 * spelled `%cxs0_t14 = getelementptr ... ; sc_tmp_t14`. Written down because a
 * version of this file that used the local form was GREEN with the repair
 * reverted.
 *
 * THE CALLEE IS A PARAMETER, which is what makes the call indirect: a `const`
 * of function type can be devirtualised, a parameter cannot.
 *
 * SHAPE B NEEDS MORE THAN `CORO_SPILL_PASS_CAP` VIOLATIONS, which is why it is
 * seven loops and not one. A single parking for-of is refused by the probe
 * exactly as the measured bodies are -- and then the one-at-a-time discovery
 * loop finds its two slots in two passes and converts it anyway. The repair is
 * only observable past the cap, so the shape has to carry fourteen slots (two
 * per loop: the cursor and the iterable). With the collector arm reverted this
 * body refuses with `cross-park-slot-passes>12`, measured, at `pass=12` with
 * `now:s=12` -- still growing when the cap stopped it. */
const SOURCE = `
type Join = (a: string, b: string) => string;

async function g(): Promise<string> {
  return "G";
}

async function tick(): Promise<number> {
  return 1;
}

async function indirectAcrossPark(f: Join): Promise<string> {
  return f("a", "b") + (await g());
}

async function indirectAcrossTwoParks(f: Join): Promise<string> {
  return f("x", "y") + (await g()) + (await g());
}

async function manyForOf(a: number[], b: number[], c: number[], d: number[], e: number[], p: number[], q: number[]): Promise<number> {
  let total = 0;
  for (const x of a) { await tick(); total = total + x; }
  for (const x of b) { await tick(); total = total + x; }
  for (const x of c) { await tick(); total = total + x; }
  for (const x of d) { await tick(); total = total + x; }
  for (const x of e) { await tick(); total = total + x; }
  for (const x of p) { await tick(); total = total + x; }
  for (const x of q) { await tick(); total = total + x; }
  return total;
}

async function manyForOfOverStrings(a: string[], b: string[], c: string[], d: string[], e: string[], p: string[], q: string[]): Promise<string> {
  let out = "";
  for (const s of a) { await tick(); out = out + s; }
  for (const s of b) { await tick(); out = out + s; }
  for (const s of c) { await tick(); out = out + s; }
  for (const s of d) { await tick(); out = out + s; }
  for (const s of e) { await tick(); out = out + s; }
  for (const s of p) { await tick(); out = out + s; }
  for (const s of q) { await tick(); out = out + s; }
  return out;
}

async function main(): Promise<void> {
  const cat: Join = (a, b) => a + b;
  console.log("indirect", await indirectAcrossPark(cat));
  console.log("indirect2", await indirectAcrossTwoParks(cat));
  console.log("forof", await manyForOf([1], [2], [3], [4], [5], [6], [7]));
  console.log("forof2", await manyForOfOverStrings(["p"], ["q"], ["r"], ["s"], ["t"], ["u"], ["v"]));
  console.log("done");
}
void main();
`;

/** The resume function's spelling is the same token on both lanes
 * (mangleCoroResume is backend-neutral): the C lane writes
 * `static void sc_cr_f(ScrCoroBase *sc_b) {` and the LLVM lane
 * `define internal void @sc_cr_f(ptr %sc_b)`. No regex -- a word-boundary
 * escape in this tree has already been eaten by a heredoc and turned into a
 * BACKSPACE, matching nothing while looking armed. */
const resumeName = (name: string): string => `sc_cr_${name}(`;

/** The four bodies this file is about, by their emitted name. They are
 * top-level function declarations, so the mangling is the bare identifier. */
const SHAPES = [
  { name: "indirectAcrossPark", shape: "A -- indirect call result crosses one park" },
  { name: "indirectAcrossTwoParks", shape: "A -- indirect call result crosses two parks" },
  { name: "manyForOf", shape: "B -- fourteen for-of slots over numbers, past the cap" },
  { name: "manyForOfOverStrings", shape: "B -- fourteen for-of slots over strings, past the cap" },
] as const;

interface Arm {
  exe: string;
  artifact: string;
}

async function buildArm(knob: boolean, backend: Lane): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  /* THE FIBER ARM IS SPELLED `0`, NOT ABSENT -- the lane ships ON as of
   * 2026-10-09, so deleting the variable would set BOTH arms to stackless and
   * this file would compare a lane with itself and report agreement. */
  process.env["SCRIPTC_STACKLESS"] = knob ? "1" : "0";
  try {
    // The knob and the backend are both part of the KEY: neither is part of
    // the compiler's own cache key, and both arms write their artifact and
    // their exe to the same two names.
    const key = createHash("sha256")
      .update(SOURCE)
      .update(knob ? "on" : "off")
      .update(backend)
      .digest("hex")
      .slice(0, 16);
    const outDir = join(cacheDir, `stackless-crosspark-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, {
      outPath: join(outDir, exeName("prog")),
      outDir,
      backend,
      keepC: true,
    });
    if (!r.ok) {
      throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    // The build PRUNES the other backend's artifact, so the name follows the
    // lane: reading the wrong one throws ENOENT, and a suite red about a
    // missing FILE looks exactly like one about a missing LOWERING.
    const artifact = readFileSync(join(outDir, backend === "llvm" ? "prog.ll" : "prog.c"), "utf8");
    return { exe: r.binaryPath, artifact };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

const EXPECTED = ["indirect abG", "indirect2 xyGG", "forof 28", "forof2 pqrstuv", "done"];

describe.each(["c", "llvm"] as const)("the cross-park shapes convert and answer (%s)", (lane) => {
  let on!: Arm, off!: Arm;
  beforeAll(async () => {
    [on, off] = [await buildArm(true, lane), await buildArm(false, lane)];
  }, 600_000);

  test("the knob reached the emitter at all", () => {
    // Without this the two tests below could both be measuring one lane twice.
    expect(off.artifact, "the fiber arm must contain no coroutine lowering").not.toMatch(
      /scr_coro_(take|finish)_/,
    );
    expect(on.artifact, "the knob did not reach the emitter").toMatch(/scr_coro_finish_/);
  });

  test("every shape has a RESUME FUNCTION -- a refusal here is silent in the output", () => {
    const missing = SHAPES.filter((s) => !on.artifact.includes(resumeName(s.name)));
    expect(
      missing.map((s) => `${s.name} (${s.shape})`),
      `these bodies fell back to a fiber on the ${lane} lane -- the output comparison cannot see it`,
    ).toEqual([]);
  });

  test("both lanes answer the same thing, and the reference answers correctly", () => {
    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const fiber = run(off.exe);
    // The reference arm must be sane before it can referee: a fiber lane that
    // was itself wrong would make a matching stackless lane look right.
    for (const line of EXPECTED) {
      expect(fiber, `the fiber arm is the reference and must be sane: ${line}`).toContain(line);
    }
    expect(run(on.exe)).toBe(fiber);
  });
});
