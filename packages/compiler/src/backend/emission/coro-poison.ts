/* THE VALUE POISON -- a planted wrong ANSWER, for proving the value guard
 * can fail on the lane it is guarding.
 *
 * WHY IT EXISTS. The most expensive defect on this front was green: a
 * bool-returning coroutine fulfilled through the promise's `f64` member left
 * `b` zero, so every `await` of it answered false whatever it returned. A
 * wrong ANSWER, not a crash, which no structural scan can see -- only running
 * two arms and comparing their output. So the output comparison is the
 * guard's only teeth for that class, and a guard whose failure path has never
 * been exercised is the shape this project has been bitten by repeatedly.
 *
 * `SCR_TICK_POISON` plants an extra microtask TURN; `SCR_CORO_ALS_BLIND`
 * plants a wrong ambient CONTEXT. Neither plants a wrong answer, and neither
 * mechanism transfers: both perturb runtime C, while a wrong finish arm is
 * EMITTED code, so the perturbation has to happen at emission.
 *
 * SPEC: docs/stackless-value-guard.md section 5.
 *
 * -- the three poisons, each a defect that actually happened --------------
 *
 *   finish-arm   fulfil a bool through finish_f64. The historical defect,
 *                quoted in coroFinish's own comment.
 *   take-arm     its mirror on the resume side: read a bool back through
 *                take_f64.
 *   park-spill   MISDIRECT one spill into a neighbouring frame field of the
 *                same type. Misdirect rather than DROP, chosen by failure
 *                mode: a dropped value is a non-dominating use that the LLVM
 *                verifier rejects at build time, so the drop variant cannot
 *                exercise the output comparison on the very lane this guard
 *                is being added for. A misdirected value dominates fine and
 *                is silently wrong on both lanes.
 *
 * NOT POISONED, and named so nobody expects it here: the owned-local defect
 * ("leaked 1 object, 2 strings and 1 array") is a LEAK, not a wrong answer --
 * the release ran as a no-op on a local the resume had re-initialised. Output
 * comparison cannot see it and never will; it belongs to the RC audit.
 *
 * -- containment ---------------------------------------------------------
 *
 * Gated on the knob by CONSTRUCTION, not by discipline: every call site is
 * inside the coroutine emission path, which runs only where coroPlans is
 * non-empty. With SCRIPTC_STACKLESS absent nothing consults this module.
 *
 * THE CACHE KEY IS ALREADY CORRECT IN BOTH DIRECTIONS, and the name is why.
 * `scriptcEnvironmentFingerprint` (frontend/early-cache.ts) is a BLANKET over
 * every SCRIPTC_* variable present in the environment, minus four that
 * configure the cache itself. So:
 *   - set   -> the variable is present -> the fingerprint changes -> the early
 *              cache cannot serve an unpoisoned build;
 *   - unset -> the variable is absent from Object.keys(env) -> the fingerprint
 *              is byte-identical -> no warm cache on the host is invalidated.
 * Both halves hold without touching the cache, which is the whole reason the
 * flag is spelled SCRIPTC_*. It must NEVER be added to CACHE_ONLY_ENV. And
 * the binary cache covers it independently: cc.ts hashes the emitted C bytes
 * into its key, so poisoned C cannot hit an unpoisoned binary either.
 * coro-poison.test.ts asserts both directions.
 */
import type { IrFunction, IrType } from "../../ir/nodes.js";

export type ValuePoison = "finish-arm" | "take-arm" | "park-spill";

const ALL: readonly ValuePoison[] = ["finish-arm", "take-arm", "park-spill"];

/** The flag's name. Spelled SCRIPTC_* deliberately -- see the header. */
export const POISON_ENV = "SCRIPTC_CORO_VALUE_POISON";

/** Which poison is armed, or null. Read per call rather than cached: the
 * tests arm and disarm around individual assertions, and a cached read would
 * make the second assertion in a file measure the first one's flag. */
export function activePoison(): ValuePoison | null {
  const v = process.env[POISON_ENV];
  return v !== undefined && (ALL as readonly string[]).includes(v) ? (v as ValuePoison) : null;
}

/* -- the site counter: the LIVENESS assertion --------------------------- */

let sites = 0;

/** How many substitutions this process has emitted. */
export function poisonSites(): number {
  return sites;
}

/** For a test that arms, emits, asserts, and disarms. */
export function resetPoisonSites(): void {
  sites = 0;
}

/** The report line. Null when no poison is armed, so a normal build prints
 * nothing and cannot pollute a stderr comparison. */
export function poisonReport(): string | null {
  const p = activePoison();
  return p === null ? null : `POISON-SITES  poison=${p}  sites=${String(sites)}`;
}

/** REFUSES AT ZERO, BY NAME. SCRIPTC_RC_AUDIT was born inert: it passed
 * without having looked at anything, because it is a build-time flag and
 * nothing asserted it had engaged. "The build succeeded" is not evidence a
 * poison ran, so this is what a harness calls instead.
 *
 * LIVENESS ONLY. Coverage is the expected RED/GREEN shape sets, asserted
 * separately AS SETS, because a poison hitting one site where twelve are owed
 * passes a count check while under-covering. The two fail differently and
 * must be read differently: zero sites means NOT WIRED, a mismatched red set
 * means WIRED TO THE WRONG PLACE. */
export function assertPoisonEngaged(): void {
  const p = activePoison();
  if (p === null) throw new Error(`${POISON_ENV} is not set: nothing to assert engaged`);
  if (sites === 0) {
    throw new Error(
      `value poison "${p}" emitted ZERO sites -- it is not wired into the emission path. ` +
        `A build that succeeds is not evidence the poison ran.`,
    );
  }
}

/* -- the substitutions -------------------------------------------------- */

/** finish-arm: fulfil a bool through the f64 member, leaving `b` zero. */
export function poisonFinishArm(retType: IrType, arm: string): string {
  if (activePoison() !== "finish-arm" || retType.kind !== "bool") return arm;
  sites++;
  return "scr_coro_finish_f64";
}

/** take-arm: read a settled bool back through the f64 accessor. */
export function poisonTakeArm(resultType: IrType, arm: string): string {
  if (activePoison() !== "take-arm" || resultType.kind !== "bool") return arm;
  sites++;
  return "scr_coro_take_f64";
}

/** park-spill: MISDIRECT one spill. Returns a permutation of the frame-local
 * ids with the first adjacent same-typed pair swapped, so the value written
 * is a real value of the right type in the WRONG slot -- it dominates, it
 * type-checks, and it is simply the wrong answer.
 *
 * Returns the list unchanged and counts NO site when no such pair exists: a
 * frame with no two same-typed locals crossing one park cannot carry this
 * defect, and counting it would let the liveness assertion pass on a function
 * the poison could not touch. */
export function poisonSpillOrder(fn: IrFunction, ids: readonly string[]): readonly string[] {
  if (activePoison() !== "park-spill" || ids.length < 2) return ids;
  const typeOf = new Map(
    (fn.locals ?? []).map((l) => [l.id, l.boxed === true ? "box" : l.type.kind] as const),
  );
  for (let i = 0; i + 1 < ids.length; i++) {
    if (typeOf.get(ids[i]!) === typeOf.get(ids[i + 1]!)) {
      const out = [...ids];
      out[i] = ids[i + 1]!;
      out[i + 1] = ids[i]!;
      sites++;
      return out;
    }
  }
  return ids;
}
