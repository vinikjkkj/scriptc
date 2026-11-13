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
import type { IrFunction, IrRecordShape, IrType, IrUnionDef } from "./nodes.js";
import { parkKeepLog, stacklessPlan, type StacklessPlan } from "./liveness.js";
import { hoistSuspendingHeaders } from "./hoist-suspensions.js";

/** Which functions this slice lowers, keyed by IR name. Computed once per
 * module: the emitters below consult it; a function with no plan fails the build. */
export interface PlanTables {
  records?: readonly IrRecordShape[];
  unions?: readonly IrUnionDef[];
}

/** Does a value of this type hold references to work still in flight (a promise or a closure), at any depth? Class instances are not
 * followed: the answer is then "no", which only means the local keeps being released at a park as before. */
function typeHoldsPending(t: IrType, tables: PlanTables, seen: Set<string>): boolean {
  switch (t.kind) {
    case "promise":
    case "func":
      return true;
    case "array":
    case "set":
      return typeHoldsPending(t.elem, tables, seen);
    case "map":
    case "weakmap":
      return typeHoldsPending(t.key, tables, seen) || typeHoldsPending(t.value, tables, seen);
    case "record": {
      if (seen.has("r" + t.shapeId)) return false;
      seen.add("r" + t.shapeId);
      const shape = tables.records?.find((r) => r.id === t.shapeId);
      if (shape === undefined) return false;
      return shape.fields.some((f) => typeHoldsPending(f.type, tables, seen)) ||
        (shape.indexValue !== undefined && typeHoldsPending(shape.indexValue, tables, seen));
    }
    case "union": {
      if (seen.has("u" + t.unionId)) return false;
      seen.add("u" + t.unionId);
      const def = tables.unions?.find((u) => u.id === t.unionId);
      return def !== undefined && def.arms.some((a) => typeHoldsPending(a, tables, seen));
    }
    default:
      return false;
  }
}

export function coroPlans(fns: readonly IrFunction[], tables: PlanTables = {}): Map<string, StacklessPlan> {
  const out = new Map<string, StacklessPlan>();
  /* There is no opt-out: the fiber lane is gone, so every async function and generator is planned or the build fails (emit-async.ts / the LLVM
   * scaffolding name the refusal). SCRIPTC_NO_FIBERS and SCRIPTC_STACKLESS=0 no longer select anything. */
  // Suspensions in statement headers the state machine cannot resume into move out of them first (ir/hoist-suspensions.ts).
  for (const fn of fns) if (fn.async === true || fn.generator !== undefined) hoistSuspendingHeaders(fn);
  for (const fn of fns) {
    // SCRIPTC_PARK_KEEP=off restores the release of promise- and closure-holding locals at a park (the A/B arm).
    const plan = stacklessPlan(fn, process.env["SCRIPTC_PARK_KEEP"] === "off" ? undefined : (t) => (t.kind === "array" || t.kind === "set" || t.kind === "map" || t.kind === "weakmap") && typeHoldsPending(t, tables, new Set<string>()));
    if (plan !== null) out.set(fn.name, plan);
  }
  if (process.env["SCRIPTC_PARK_KEEP_STAT"] === "1" && parkKeepLog.length > 0) {
    const kept = parkKeepLog.filter((l) => l.startsWith("KEPT\t"));
    const rel = parkKeepLog.filter((l) => l.startsWith("RELEASED-ARRAY\t"));
    process.stderr.write(parkKeepLog.join("\n") + `\nPARKKEEP-SUMMARY kept=${kept.length} released-array-locals=${rel.length}\n`);
    parkKeepLog.length = 0;
  }
  return out;
}
