/* THE VALUE GUARD FOR GENERATOR CHANNELS -- written BEFORE the shapes it
 * guards, because the failure it exists to catch is the one this front has
 * paid most for: a value that silently takes the wrong type arm while every
 * gate stays green.
 *
 * WHY A POISON AND NOT A TEST. A cross-lane parity test compares the two
 * lanes' output and passes when they agree. It also passes when the
 * comparison is blind -- when both arms are the same code, when the binary
 * never ran, when the channel carries a value whose wrong arm happens to
 * print the same. None of those is distinguishable from a real green, and
 * "could this have come out red?" is a question a parity test cannot answer
 * about itself. This module is the answer: it injects a WRONG ARM on
 * demand, so the guard can be watched failing before it is trusted passing.
 *
 * WHAT IT SWAPS, AND WHY ONLY THIS. The yield channel has three arms --
 * f64, bool and ref -- selected from the yielded value's type. Only f64 and
 * bool are interchangeable at the C level: both take one scalar, so the
 * swapped call compiles and the defect is purely a VALUE defect, which is
 * the class being guarded. Swapping either into `ref` would change the
 * argument list and fail at the compiler instead of at the value, which
 * tests nothing about the guard.
 *
 * IT MUST REFUSE WHEN IT DID NOTHING. A poison that silently finds no site
 * produces a clean binary, the parity test passes, and the run is recorded
 * as "the guard was proved able to fail" when nothing was injected at all.
 * That is the same green-by-construction shape one layer up, so
 * `assertGenPoisonEngaged` aborts BY NAME at zero sites. A poison arm whose
 * program has no scalar yield fails loudly rather than quietly.
 *
 * KNOB-ABSENT IS UNTOUCHED. Every entry point below returns its argument
 * unchanged when the environment variable is unset, so a build with no
 * poison emits byte-identical C to one compiled without this module. */

/** Which wrong arm to take. One value today; the type exists so a second
 * cannot be added as a bare string. */
export type GenValuePoison = "yield-arm";

export const GEN_POISON_ENV = "SCRIPTC_GEN_VALUE_POISON";

/** The three yield entry points, as the emitter selects them. */
export interface YieldArms {
  readonly f64: string;
  readonly bool: string;
  readonly ref: string;
}

let sites = 0;

function activePoison(): GenValuePoison | null {
  const v = process.env[GEN_POISON_ENV];
  return v === "yield-arm" ? "yield-arm" : null;
}

/** Sites injected so far in this process. Read by the assertion below and
 * by tests; never by emission. */
export function genPoisonSites(): number {
  return sites;
}

/** Reset between compiles in one process. Tests that build twice must call
 * this, or the second build inherits the first one's count and the
 * assertion passes on evidence from the wrong build. */
export function resetGenPoison(): void {
  sites = 0;
}

/** Choose the yield entry point for a value of kind `kind`.
 *
 * Unpoisoned this is exactly the selection the emitter would have written
 * inline. Poisoned, a f64 yield goes through the bool entry point and a
 * bool yield through the f64 one -- the value is mangled, the call still
 * compiles, and nothing else about the program changes. */
export function poisonYieldArm(kind: string, arms: YieldArms): string {
  const straight = kind === "f64" ? arms.f64 : kind === "bool" ? arms.bool : arms.ref;
  if (activePoison() !== "yield-arm") return straight;
  if (kind === "f64") {
    sites++;
    return arms.bool;
  }
  if (kind === "bool") {
    sites++;
    return arms.f64;
  }
  return straight; // ref is not interchangeable; see the header
}

/** Abort the build if the poison was requested and injected nothing.
 *
 * BY NAME, because the failure this prevents is a test reporting that it
 * proved the guard able to fail when the guard was never perturbed. The
 * message says which poison and that zero sites were found, so the fix --
 * a program with a scalar yield in it -- is readable from the error. */
export function assertGenPoisonEngaged(): void {
  const p = activePoison();
  if (p === null) return;
  if (sites === 0) {
    throw new Error(
      `${GEN_POISON_ENV}=${p} was requested and injected ZERO sites. ` +
        `The program compiled contains no f64 or bool yield, so nothing was ` +
        `poisoned and any test green that follows is evidence about nothing.`,
    );
  }
}
