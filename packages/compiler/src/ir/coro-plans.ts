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
  if (process.env["SCRIPTC_STACKLESS"] !== "1") return out;
  for (const fn of fns) {
    const plan = stacklessPlan(fn);
    if (plan !== null) out.set(fn.name, plan);
  }
  return out;
}
