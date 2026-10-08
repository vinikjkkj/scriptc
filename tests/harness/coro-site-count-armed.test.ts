/* THE ARMING SELF-TEST FOR THE SUSPENSION-SITE INVARIANT.
 *
 * Its ONLY job is to prove the detector in backend/llvm/coro.ts CAN fail. It
 * is not a test of the lowering; the lowering is covered by value, by turn
 * count and by the partition in stackless-values.test.ts, and every one of
 * those asserts that the invariant was SATISFIED. "It was satisfied" and "it
 * still detects anything" are independent claims, and covering only the first
 * is the most convincing way to cover nothing: the counter reads right, the
 * suite is green, and the rule underneath may have stopped matching years ago.
 *
 * It follows size-class-armed.test.ts, which states the property that makes
 * this shape work (:12): "no compiler, no linker, no toolchain". These are
 * pure-function calls over hand-written `.ll` text, so they run everywhere and
 * nothing external can make them pass.
 *
 * THE UNION CASES ARE HERE BEFORE THE UNION IS, deliberately. This backend
 * lowers no `awaitUnionExpr` yet, so `unionPoints` is always 0 at the live call
 * site and the term is untested by every real build. An untested term in a
 * formula is where the off-by-one waits: the day the two-armed point arrives,
 * whoever adds it meets either a correct assertion or a failing one, and a
 * failing one at that moment invites loosening rather than fixing. Pinning both
 * union directions now means the arithmetic is settled while nothing depends
 * on the answer. */
import { describe, expect, test } from "vitest";
import {
  coroCheckSuspensionSites,
  coroSuspensionSites,
} from "../../packages/compiler/src/backend/llvm/coro.js";

/** A park site as the emitter spells it. */
const PARK = "  %t9 = call i32 @scr_coro_park(ptr %sc_b, ptr %t8)";
/** A hop site as the emitter spells it. */
const HOP = "  call void @scr_coro_hop(ptr %sc_b)";
/** Body noise that must NOT be counted: declares, and the runtime's own name
 * appearing somewhere that is not a call. */
const NOISE = [
  "declare i32 @scr_coro_park(ptr, ptr)",
  "declare void @scr_coro_hop(ptr)",
  "  ; scr_coro_park is named in this comment and is not a call site",
  "  %t1 = load i32, ptr %t0",
].join("\n");

const body = (...sites: string[]): string => [NOISE, ...sites].join("\n");

describe("the suspension-site counter counts call sites", () => {
  test("declares and comments are not call sites", () => {
    expect(coroSuspensionSites(NOISE)).toEqual({ parks: 0, hops: 0 });
  });

  test("parks and hops are counted apart", () => {
    expect(coroSuspensionSites(body(PARK, HOP, HOP))).toEqual({ parks: 1, hops: 2 });
  });
});

describe("the suspension-site invariant is armed", () => {
  /* The GREEN cases first. Without these the rule could be trivially red --
   * a detector that rejects everything detects nothing. */

  test("ACCEPTS one park per drawn state", () => {
    expect(() => coroCheckSuspensionSites("f", body(PARK, PARK), 2, 0)).not.toThrow();
  });

  test("ACCEPTS a bare hop per drawn state", () => {
    expect(() => coroCheckSuspensionSites("f", body(HOP, HOP, HOP), 3, 0)).not.toThrow();
  });

  test("ACCEPTS a park and a hop sharing ONE state at a two-armed point", () => {
    // 1 point, 1 state, 1 resume label, TWO suspension calls. This is the
    // measured shape of sc_cr_wav / waun / waus on the C lane.
    expect(() => coroCheckSuspensionSites("wav", body(PARK, HOP), 1, 1)).not.toThrow();
  });

  test("ACCEPTS a mixed body: two ordinary points and one two-armed point", () => {
    expect(() => coroCheckSuspensionSites("f", body(PARK, HOP, PARK, HOP), 3, 1)).not.toThrow();
  });

  /* The RED cases. Each is a defect that every other check on this lane is
   * blind to, and the message has to name which way it went wrong. */

  test("FIRES when a point drew a state and emitted no suspension call", () => {
    // The defect with no other detector: the function never returns to the
    // scheduler. Every value it produces is still correct and only the TURN
    // COUNT is wrong, so a value comparison agrees with it.
    expect(() => coroCheckSuspensionSites("f", body(PARK), 2, 0))
      .toThrow(/emitted 1 park\(s\) and 0 hop\(s\).*drew 2 state\(s\)/s);
  });

  test("FIRES when a point emitted its suspension call twice", () => {
    expect(() => coroCheckSuspensionSites("f", body(PARK, PARK), 1, 0))
      .toThrow(/requires 1/);
  });

  test("FIRES on a ONE-ARMED two-armed point -- the arm that was dropped", () => {
    // THE CASE THE WHOLE unionPoints TERM EXISTS FOR. A two-armed point whose
    // hop arm was never emitted still parks correctly on every input that takes
    // the promise arm, so a value comparison driving only that arm is green,
    // and the first invariant (boundaries === states === points) is satisfied
    // exactly: one point, one state, one label, one boundary. This is the only
    // thing that can report it.
    expect(() => coroCheckSuspensionSites("wav", body(PARK), 1, 1))
      .toThrow(/1 two-armed point\(s\), which requires 2/);
    // ... and symmetrically with the park arm dropped.
    expect(() => coroCheckSuspensionSites("wav", body(HOP), 1, 1))
      .toThrow(/1 two-armed point\(s\), which requires 2/);
  });

  test("FIRES when a two-armed point is counted as an ordinary one", () => {
    // The off-by-one the term is carried from day one to prevent: the union
    // arrives, its two calls land, and nobody adds it to `unionPoints`.
    expect(() => coroCheckSuspensionSites("wav", body(PARK, HOP), 1, 0))
      .toThrow(/requires 1/);
  });
});
