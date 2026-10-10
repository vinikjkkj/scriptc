/* WHICH FUNCTIONS THE STACKLESS LANE LOWERS -- the knob read, over the
 * backend-agnostic analysis.
 *
 * RELOCATED FROM backend/emission/emit-coro.ts, and it is a fix for a wrong
 * address rather than a step of any port. The body reads an IrFunction
 * array, one environment variable and `stacklessPlan`, and has no
 * C-specific dependency of any kind; its consumers are `index.ts` and
 * `cc.ts` (through index), both backend-agnostic. Living inside the C
 * emitter made a backend-agnostic policy look C-specific, which is exactly
 * what made "does the LLVM lane need its own?" read as an open decision
 * when it never was.
 *
 * WHY HERE AND NOT IN ir/liveness.ts. liveness is pure analysis over the
 * IR; this function reads `process.env`. Keeping the knob out of the
 * analysis module is the same separation that lets the ladder and ceiling
 * instruments call `stacklessPlan` directly without a knob in scope.
 *
 * Behaviour is unchanged: the function below is the moved text, and the
 * admitted NAME SET was compared across the move by set identity (1,099
 * names on zapo-rest/app182, zero added, zero removed) rather than by
 * count, because two sets of 1,099 can be different sets.
 */
import type { IrFunction } from "./nodes.js";
import { stacklessPlan, type StacklessPlan } from "./liveness.js";

/** Which functions this slice lowers, keyed by IR name. Computed once per
 * module: the emitters below and emit-async.ts's fiber path both consult it,
 * and a function appearing in neither or both would emit a duplicate symbol
 * or none at all. */
export function coroPlans(fns: readonly IrFunction[]): Map<string, StacklessPlan> {
  const out = new Map<string, StacklessPlan>();
  /* THE DEFAULT IS ON; THE OPT-OUT IS SPELLED `0` AND NOTHING ELSE.
   *
   * This read INVERTED on 2026-10-09. The lowering used to ship OFF with
   * `SCRIPTC_STACKLESS=1` opting in; it now ships ON with
   * `SCRIPTC_STACKLESS=0` opting out. Absent is ON, and so is every other
   * value: `0` is the ONLY spelling that disables the lane. That asymmetry
   * is deliberate. A misspelled opt-out ships the DEFAULT lane rather than
   * silently restoring the old one, so a rig that means to measure the
   * fiber arm and gets the spelling wrong reads a visibly wrong arm instead
   * of a quietly right-looking one.
   *
   * WHY AN OPT-OUT SURVIVES THE FLIP rather than this read being deleted.
   * The fiber lane is the REFERENCE ARM of every instrument on this front,
   * and an instrument whose reference arm is gone does not fail -- it
   * compares a lane with itself and reports agreement. These nine set the
   * knob per arm and would do exactly that:
   *
   *   tests/harness/stackless-values.test.ts            buildArm
   *   tests/harness/stackless-finally-body.test.ts      buildArm, build
   *   tests/harness/stackless-then-adapter.test.ts      buildArm
   *   tests/harness/llvm-stackless-lifted.test.ts       buildArm
   *   tests/harness/coro-abandoned-count.test.ts        buildAndRun
   *   tests/harness/generator-lane-parity.test.ts       OFF / OFF_AUDIT
   *   tests/harness/stackless-opt-out-identity.test.ts  leg
   *   packages/compiler/test/coro-poison.test.ts        buildArm
   *   tests/perf/llvmparity/knobon-preflight.ps1        the "off" arm
   *
   * Keeping the read is what let all nine be RESPELLED (`0` where they said
   * "absent") instead of deleted. This is a change of DEFAULT, not the
   * removal of a lane: both lowerings are still built, still emitted, and
   * still differentially compared against each other. */
  if (process.env["SCRIPTC_STACKLESS"] === "0") return out;
  for (const fn of fns) {
    const plan = stacklessPlan(fn);
    if (plan !== null) out.set(fn.name, plan);
  }
  return out;
}
