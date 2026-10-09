/* THE LIFTED ARM OF THE LLVM STACKLESS LOWERING, which nothing else reaches.
 *
 * stackless-values.test.ts is the value coverage for this lane and it carries
 * 79 wrappers, every one of them a TOP-LEVEL async function. Not one is
 * LIFTED -- an async closure that captures an outer binding -- so the whole
 * `sc_env` arm of the lowering had no test at all: the frame field, the
 * closure's +1 taken in the spawn wrapper, and the release that every one of
 * the FOUR completion paths owes.
 *
 * WHY THAT ARM IS WORTH ITS OWN FILE RATHER THAN A WRAPPER IN THE OTHER ONE.
 * Adding a lifted wrapper there would change the shared program, whose output
 * is pinned line by line as absolute values on BOTH lanes -- so a new wrapper
 * perturbs the C lane's assertions to buy an LLVM-lane gap. The gap is real
 * and small; this closes it without touching the pinned program.
 *
 * WHAT A FAILURE HERE LOOKS LIKE, so a reader knows what it is reporting:
 *   - wrong VALUE: the per-closure capture was not carried across the park
 *     (both closures answering the same thing is the signature), or the env
 *     reload read the wrong frame field;
 *   - a CRASH: the closure was released more times than it was retained --
 *     the spawn takes one +1 and each completion path drops exactly one, so a
 *     second release on any path is a use-after-free;
 *   - a LEAK, which this file does NOT catch and does not claim to: nothing
 *     here counts refcounts. stackless-rc-balance is that instrument and it is
 *     pinned to the C lane.
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

/* Two lifted coroutines, one per completion arm that can carry a value
 * (`finish_ref` and `finish_f64`), each a SINGLE root-position await so both
 * are inside the LLVM lane's admission. The capture is read AFTER the resume
 * in both, which is the only thing that distinguishes a frame that carried
 * sc_env from one that did not -- a closure read before the park would answer
 * correctly either way.
 *
 * TWO INSTANCES of the ref one, with DIFFERENT captures, awaited after each
 * other: one shared env, or an env read from the wrong frame, answers the same
 * string twice. "A!:1 B!:2" is the only correct line and "A!:1 A!:1" is the
 * failure the single-instance version could not see. */
const SOURCE = `
async function ps(v: string): Promise<string> { return v + "!"; }
async function pf(n: number): Promise<number> { return n + 1; }
function mk(tag: string, k: number): () => Promise<string> {
  const inner = async (): Promise<string> => { const x = await ps(tag); return x + ":" + String(k); };
  return inner;
}
function mkn(k: number): () => Promise<number> {
  const inner = async (): Promise<number> => { const v = await pf(k); return v * 2; };
  return inner;
}
async function main(): Promise<void> {
  console.log("lifted-ref", await mk("T", 7)());
  console.log("lifted-f64", await mkn(5)());
  const a = mk("A", 1), b = mk("B", 2);
  console.log("two", await a(), await b());
}
void main();
`;

interface Arm {
  exe: string;
  artifact: string;
}

async function buildArm(knob: boolean): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  /* THE FIBER ARM IS SPELLED `0`, NOT ABSENT. The lane ships ON as of
   * 2026-10-09 (ir/coro-plans.ts), so `delete` here would set BOTH arms to
   * stackless and this file would compare a lane with itself and report
   * agreement. Do not "simplify" it back to a delete. */
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else process.env["SCRIPTC_STACKLESS"] = "0";
  try {
    // The knob is part of the KEY: two arms sharing an output directory would
    // share one binary and the comparison would pass by being the same
    // program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `llvm-stackless-lifted-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, backend: "llvm" });
    if (!r.ok) throw new Error(r.diagnostics.map((d: any) => `${d.code}: ${d.message}`).join("\n"));
    // prog.ll, never prog.c: an LLVM build prunes the other backend's
    // artifact, so the C name is not on disk at all.
    return { exe: r.binaryPath, artifact: readFileSync(join(outDir, "prog.ll"), "utf8") };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

const EXPECTED = ["lifted-ref T!:7", "lifted-f64 12", "two A!:1 B!:2"];

describe("the LLVM stackless lane carries a lifted closure's environment", () => {
  let on!: Arm, off!: Arm;
  beforeAll(async () => {
    [on, off] = [await buildArm(true), await buildArm(false)];
  }, 600_000);

  test("the lifted bodies really are converted, and carry sc_env in the frame", () => {
    // THE ARMING CHECK. Without it every assertion below passes on a build
    // where the knob never reached the emitter -- the fiber lane answers the
    // same values, which is exactly what makes a dropped conversion invisible
    // to an output comparison.
    expect(off.artifact, "the fiber arm must contain no coroutine lowering")
      .not.toMatch(/scr_coro_(take|finish)_/);
    expect(on.artifact, "the knob did not reach the emitter").toMatch(/scr_coro_finish_/);
    // A lifted frame carries sc_env as its first member after the base. If the
    // lowering stopped lifting, this is the assertion that says so rather than
    // the values.
    const frames = on.artifact.match(/^%sc_cf_\S+ = type \{[^}]*\} ; base, sc_env \(lifted\).*$/gm) ?? [];
    expect(frames.length, "no LIFTED coroutine frame was emitted -- this file guards nothing")
      .toBeGreaterThanOrEqual(2);
    // The +1 the frame holds, taken once in the spawn wrapper.
    expect(on.artifact, "the spawn wrapper must take the closure's +1")
      .toContain("call ptr @scr_closure_retain_v");
    expect(on.artifact, "every completion path must drop it")
      .toContain("call void @scr_closure_release");
  });

  test("the values survive the park, per closure instance", () => {
    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const fiber = run(off.exe);
    // The reference arm has to be sane before it can referee.
    for (const line of EXPECTED) {
      expect(fiber, `the reference arm must already answer: ${line}`).toContain(line);
    }
    const stackless = run(on.exe);
    expect(stackless, "the stackless lane disagrees with fibers").toEqual(fiber);
    for (const line of EXPECTED) {
      expect(stackless, `the stackless lane answers the wrong value: ${line}`).toContain(line);
    }
  }, 600_000);
});
