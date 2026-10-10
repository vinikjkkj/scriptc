/* AN ASYNC FUNCTION THAT NEVER SUSPENDS MUST NOT PAY FOR A FIBER.
 *
 * WHY THIS EXISTS. The coverage frontier was censused on 2026-10-10 over the
 * user's own program (zapo-rest/app182) and the shape of what was left is not
 * what the ladder's rows suggested: of the 188 functions still spawning a
 * stackful fiber, 184 were `async` functions containing NO SUSPENDER AT ALL --
 * async methods implementing an async interface with a synchronous body, 65 of
 * them lifted closures. Nothing excluded them. There was nothing in them to
 * lower, `suspensionLiveness` returned null, and `stacklessPlan` read that
 * absence as a refusal.
 *
 * They paid the full fiber anyway, and that is what this file guards. The
 * spawn wrapper called `scr_async_spawn`, which callocs a ScrFiber, mallocs an
 * argpack, takes a pooled stack through `scr_stack_acquire()`, performs TWO
 * `scr_switch` context switches and restores the current-fiber, exception-cell
 * and AsyncLocalStorage globals on the way back -- to run a body that cannot
 * suspend.
 *
 * WHAT A ZERO-POINT CONVERSION IS NOT. It is not "a frame with nothing in it".
 * `coroFrameLocals` carries every PARAMETER unconditionally, because the resume
 * function has no parameters of its own, plus every refcounted or boxed local.
 * So the frame this lowering allocates is the argpack the fiber lowering
 * allocated, under another name -- the saving is the fiber, not the frame, and
 * the functions below are written WITH parameters so this file is over that
 * real shape rather than over an empty one.
 *
 * THE FAILURE PATH IS THE WHOLE SEMANTIC RISK, and it is why `nthrow` is here.
 * JS says an async function body runs synchronously to its first `await`, so a
 * body with no `await` runs to completion inside the call -- but a body that
 * THROWS must still return a REJECTED PROMISE and must never throw at its call
 * site. On this lane the rejection is explicit: the resume body ends in
 * `scr_coro_finish_throw`, which moves the pending exception out of the active
 * cell and into the promise. `caller-survived` is the line that goes missing if
 * that ever becomes a synchronous throw -- and it is a line the OUTPUT
 * comparison can see, unlike the structural assertions.
 *
 * TWO CONTROLS THAT CAN GO RED IN OPPOSITE DIRECTIONS, because a lowering that
 * silently stops happening makes the two arms MORE equal, not less:
 *
 *   1. the fiber arm must contain a TRAMPOLINE for each of these functions and
 *      no resume function for them;
 *   2. the stackless arm must contain a RESUME function for each and no
 *      trampoline for them.
 *
 * Only (2) fails on the parent commit; (1) is the pin that keeps (2) from being
 * green by construction, because it proves the knob reached the emitter and
 * that the fiber lowering is what it replaced. Asserting the trampoline's
 * ABSENCE matters as much as the resume function's presence: emitting both
 * would be two definitions of one spawn-wrapper symbol, which is the specific
 * way this fork breaks.
 *
 * `nv` and `nb` are not decoration. `scr_coro_finish_bool` and
 * `scr_coro_finish_f64` write SEPARATE members of ScrPromise, and routing a
 * bool through the f64 arm was a shipped silent-wrong-answer bug on this very
 * lane (62 coroutines in zapo-rest, every Noise certificate rejected). A
 * zero-point function reaches the same completion dispatch, so each payload
 * kind it can return is given a distinguishable value here. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

type Lane = "c" | "llvm";

/* The functions this file is about, by IR name -- which is also the suffix of
 * both the resume function and the trampoline, so one list drives both
 * controls. Every one of them is `async` and contains no `await`, no `yield`
 * and no suspending libCall.
 *
 * `nlift` IS DELIBERATELY NOT IN THIS LIST, and the reason is worth writing
 * down because it cost this file a red run. Lambda lifting renames the
 * closure: the arrow function the source calls `nlift` reaches the IR as
 * `%fnN`, so NO artifact symbol carries the source name and a by-name
 * assertion for it fails whether or not the lowering worked. (On
 * zapo-rest/app182 all 65 lifted members of this idiom are spelled `%fnNNN`.)
 * The lifted shape is still guarded, twice and without naming it: the
 * TRAMPOLINE COUNTS below are over the whole program, so a closure left on
 * the fiber lane shows up as a trampoline the stackless arm must not have;
 * and `nlift 21` in the output test proves the captured value survived. */
const NOSUSPEND = ["nf", "nb", "ns", "nv", "nr", "nthrow"] as const;

/* Every async function in the program: the six above, the lifted closure, and
 * `main` (which DOES await, so it converts for the ordinary reason). The
 * counts are what guard the lifted closure, whose source name the artifact
 * never carries. */
const ASYNC_FNS = NOSUSPEND.length + 2;

const countOf = (hay: string, needle: string): number => hay.split(needle).length - 1;
/* A trampoline is counted at its DEFINITION, not at every mention: the C lane
 * also forward-declares it and takes its address at the spawn site, so a naive
 * count of the symbol would be three times the number of functions and would
 * move for reasons that have nothing to do with the lowering. */
const trampolineDefs = (artifact: string, lane: Lane): number =>
  lane === "llvm"
    ? countOf(artifact, "define internal void @sc_tr_")
    : (artifact.match(/sc_tr_[A-Za-z0-9_]+\(ScrFiber \*sc_self/g) ?? []).length;

const SOURCE = [
  "async function nf(a: number, b: number): Promise<number> {",
  "  return a * 10 + b;",
  "}",
  "async function nb(a: number): Promise<boolean> {",
  "  return a > 0;",
  "}",
  "async function ns(a: string): Promise<string> {",
  '  return a + "!";',
  "}",
  "async function nv(a: number): Promise<void> {",
  '  console.log("nv ran", a);',
  "}",
  "async function nr(a: number): Promise<number[]> {",
  "  return [a, a + 1];",
  "}",
  "async function nthrow(a: number): Promise<number> {",
  '  throw "nthrow " + String(a);',
  "}",
  "function liftme(): () => Promise<number> {",
  "  const captured = 7;",
  "  // A lifted closure: 65 of the 184 censused functions are this shape, and",
  "  // the frame carries the closure environment as its own field.",
  "  const nlift = async (): Promise<number> => captured * 3;",
  "  return nlift;",
  "}",
  "async function main(): Promise<void> {",
  '  console.log("nf", await nf(4, 2));',
  '  console.log("nb", await nb(1), await nb(-1));',
  '  console.log("ns", await ns("x"));',
  "  await nv(9);",
  '  console.log("nr", (await nr(5)).join(","));',
  '  console.log("nlift", await liftme()());',
  "  // THE CALL ITSELF MUST NOT THROW. If a zero-point lowering ever let the",
  "  // exception escape the spawn wrapper, this line would unwind past the",
  '  // assignment and "caller-survived" would never print -- while every other',
  "  // line above still matched.",
  "  const p = nthrow(3);",
  '  console.log("caller-survived");',
  "  try {",
  '    console.log("not-reached", await p);',
  "  } catch (e) {",
  '    console.log("rejected", String(e));',
  "  }",
  "}",
  "main();",
  'console.log("spawned");',
  "",
].join(String.fromCharCode(10));

interface Arm {
  exe: string;
  artifact: string;
}

const resumeName = (n: string): string => `sc_cr_${n}`;
const trampolineName = (n: string): string => `sc_tr_${n}`;

async function buildArm(knob: boolean, backend: Lane): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  /* THE FIBER ARM IS SPELLED `0`, NOT ABSENT -- the lane ships ON, so a
   * `delete` here would set both arms to stackless and this file would compare
   * a lane with itself and report agreement. */
  process.env["SCRIPTC_STACKLESS"] = knob ? "1" : "0";
  try {
    // The knob and the backend are both part of the key: two arms sharing an
    // output directory would share one binary, and the comparison would pass
    // by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").update(backend).digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-nosuspend-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend, keepC: true });
    if (!r.ok) {
      throw new Error(r.diagnostics.map((d: { code: string; message: string }) => `${d.code}: ${d.message}`).join("\n"));
    }
    return {
      exe: r.binaryPath,
      artifact: readFileSync(join(outDir, backend === "llvm" ? "prog.ll" : "prog.c"), "utf8"),
    };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

describe.each(["c", "llvm"] as const)("an async function with no suspender converts (%s)", (lane) => {
  let on!: Arm, off!: Arm;
  beforeAll(async () => {
    [on, off] = [await buildArm(true, lane), await buildArm(false, lane)];
  }, 600_000);

  test("the fiber arm spawns a fiber for every one of them", () => {
    /* THE ARMING HALF. Without it the test below could pass on a tree where
     * these functions stopped being emitted at all, and it is also what proves
     * the knob reached the emitter rather than the two arms being one build. */
    expect(
      NOSUSPEND.filter((n) => !off.artifact.includes(trampolineName(n))),
      "the fiber arm must spawn a fiber for each -- otherwise there is nothing for the knob to remove",
    ).toEqual([]);
    expect(
      NOSUSPEND.filter((n) => off.artifact.includes(resumeName(n))),
      "the fiber arm must have no resume function for these",
    ).toEqual([]);
    /* BY COUNT, which is what covers the lifted closure. Every async function
     * in this program is a fiber on this arm -- the six named ones, the lifted
     * one whose name lifting took away, and `main`. */
    expect(
      trampolineDefs(off.artifact, lane),
      "the fiber arm must spawn a fiber for EVERY async function, the lifted closure included",
    ).toBe(ASYNC_FNS);
  });

  test("the stackless arm converts every one of them and spawns no fiber", () => {
    /* THE HALF THAT FAILS ON THE PARENT. Before the three sites opened
     * (ir/liveness.ts's empty plan, llvm/coro.ts's points=0 refusal and the
     * llvm emitter's zero-point assert) every name below was a trampoline on
     * both arms, and the red check on b919a675a has this list coming back
     * holding all six, on both lanes. */
    expect(
      NOSUSPEND.filter((n) => !on.artifact.includes(resumeName(n))),
      "these never-suspending async functions still pay for a fiber",
    ).toEqual([]);
    /* AND THE TRAMPOLINE MUST BE GONE. Emitting both lowerings for one
     * function is two definitions of its spawn wrapper -- the specific way the
     * fork in emitAsyncScaffolding breaks if the plan and the fiber path ever
     * stop being mutually exclusive. */
    expect(
      NOSUSPEND.filter((n) => on.artifact.includes(trampolineName(n))),
      "these carry BOTH lowerings -- their spawn wrapper is defined twice",
    ).toEqual([]);
    /* NOT ONE FIBER LEFT IN THE PROGRAM, which is the assertion that reaches
     * the lifted closure. On the parent this read 8; it must read 0. */
    expect(
      trampolineDefs(on.artifact, lane),
      "a fiber survives on the stackless arm -- the lifted closure is the one this catches",
    ).toBe(0);
  });

  test("both arms answer the same thing, rejection included", () => {
    const run = (exe: string): string =>
      execFileSync(exe, [], { encoding: "utf8" }).split(String.fromCharCode(13)).join("");
    const a = run(on.exe);
    const b = run(off.exe);
    expect(a).toEqual(b);
    /* NOT JUST EQUAL -- RIGHT. Two arms can agree by both being wrong, and the
     * bool arm has already shipped exactly that failure once. */
    expect(a).toContain("nf 42");
    expect(a).toContain("nb true false");
    expect(a).toContain("ns x!");
    expect(a).toContain("nv ran 9");
    expect(a).toContain("nr 5,6");
    expect(a).toContain("nlift 21");
    /* The call site survived a body that threw, and the promise rejected. */
    expect(a).toContain("caller-survived");
    expect(a).toContain("rejected nthrow 3");
    expect(a).not.toContain("not-reached");
  });
});
