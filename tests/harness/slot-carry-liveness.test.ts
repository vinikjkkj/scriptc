/* THE SLOT-CARRY LIVENESS, DRIVEN DIRECTLY -- no compiler, no toolchain.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ARTIFACT CHECKS. The cross-park
 * slot oracle reads a real emitted module and asks whether the result is
 * sound; it is the backstop and it must stay one. What it cannot tell anyone
 * is whether the analysis is DISCRIMINATING: an analysis that returned "carry
 * everything" for every input would pass the oracle for ever, buy nothing, and
 * read exactly as green. So both directions are proved here on hand-written
 * CFGs where the right answer is known by construction -- every case asserts
 * what is KEPT and what is DROPPED, and no case is allowed to be green merely
 * by carrying more.
 *
 * THE BACK EDGE IS THE CASE THIS FILE IS REALLY FOR, and it is armed rather
 * than asserted: the same body appears twice, once with the resume block
 * branching back to the loop head and once branching past it, and the only
 * difference in the expected answer is that edge. A liveness that ignored back
 * edges -- which is exactly what blocks.ts's two emission-ordered rules do,
 * by construction -- passes the second and fails the first.
 *
 * THE CHAIN IS THE OTHER ONE. The first version of slot-liveness.ts struck
 * every `%cxslot_` line from its scan, which is right for the reload and wrong
 * for the SPILL: the spill is a real read of the slot, so a slot read after
 * park 1 must also be carried across park 0, or park 1's spill saves whatever
 * the entry block re-initialised. The oracle caught sixteen of those in
 * `sc_cr_main`. The pair of cases below is that defect, kept as a test. */
import { describe, expect, test } from "vitest";
import { slotCarryLiveness, withoutSlotCarry } from "../../packages/compiler/src/backend/llvm/slot-liveness.js";

/** The shape BlockBuilder.render() produces, which is what the analysis parses:
 * a `define` line, then `label:` at column zero with two-space instructions. */
const body = (...blocks: string[]): string =>
  `define internal void @sc_cr_t(ptr %sc_b) #0 { ; stackless t\n${blocks.join("\n")}\n}`;

const DISPATCH = (...states: number[]): string =>
  [
    "entry:",
    "  %sl = alloca double",
    "  store double 0.000000e+00, ptr %sl",
    "  %st = getelementptr inbounds %ScrCoroBase, ptr %sc_b, i64 0, i32 3 ; base.state",
    "  %d = load i32, ptr %st",
    `  switch i32 %d, label %bad [ i32 0, label %sc_S0 ${states
      .map((k) => `i32 ${k + 1}, label %sc_S${k + 1}`)
      .join(" ")} ]`,
  ].join("\n");

const BAD = ["bad:", "  unreachable"].join("\n");

/** The spill emitCoroSlotSpill writes at state `k`, verbatim in its shape. */
const spill = (k: number): string =>
  [
    `  %cxslot_sv${k}_sl = load double, ptr %sl ; spill sc_slot_sl`,
    `  %cxslot_sp${k}_sl = getelementptr inbounds %sc_cf_t, ptr %sc_b, i64 0, i32 9 ; sc_slot_sl`,
    `  store double %cxslot_sv${k}_sl, ptr %cxslot_sp${k}_sl`,
  ].join("\n");

/** The reload emitCoroSlotReload writes at state `k`. */
const reload = (k: number): string =>
  [
    `  %cxslot_rp${k}_sl = getelementptr inbounds %sc_cf_t, ptr %sc_b, i64 0, i32 9 ; sc_slot_sl`,
    `  %cxslot_rv${k}_sl = load double, ptr %cxslot_rp${k}_sl`,
    `  store double %cxslot_rv${k}_sl, ptr %sl ; reload sc_slot_sl`,
  ].join("\n");

const ask = (src: string, states: number): Set<number> => {
  const r = slotCarryLiveness(src, ["%sl"], states);
  expect(r, "the analysis declined a body this file wrote to be readable").not.toBeNull();
  return r!.get("%sl")!;
};

describe("the slot carry is spent only where the slot is live", () => {
  test("a slot written before it is read again is NOT carried", () => {
    // sc_S1 stores into the slot before any load, so nothing arrives from the
    // far side of the park and the carry is dead text.
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  store double 2.000000e+00, ptr %sl", "  %u = load double, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 1)]).toEqual([]);
  });

  test("a slot read before it is written IS carried", () => {
    // The same body with the two lines in sc_S1 swapped. This is the control
    // for the case above: if the analysis answered "drop" for both, the first
    // test would still be green.
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  %u = load double, ptr %sl", "  store double 2.000000e+00, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 1)]).toEqual([0]);
  });

  test("a read reachable ONLY through a back edge is carried", () => {
    // `head` is appended BEFORE the park and re-entered from the resume block.
    // The only load of the slot is at the top of it. Emission order cannot see
    // that; the CFG can.
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %head"].join("\n"),
      ["head:", "  %c = load double, ptr %sl", "  %p = fcmp olt double %c, 1.000000e+01", "  br i1 %p, label %p0, label %done"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  br label %head"].join("\n"),
      ["done:", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 1)]).toEqual([0]);
  });

  test("...and the SAME body without that back edge drops it", () => {
    // ARMED. One edge changes, and it is the edge. A liveness blind to back
    // edges answers [] for both this and the case above; it passes this one.
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %head"].join("\n"),
      ["head:", "  %c = load double, ptr %sl", "  %p = fcmp olt double %c, 1.000000e+01", "  br i1 %p, label %p0, label %done"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  br label %done"].join("\n"),
      ["done:", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 1)]).toEqual([]);
  });

  test("the carry is a CHAIN: a read after park 1 carries park 0 as well", () => {
    // THE DEFECT THE ORACLE CAUGHT, kept as a test. Nothing in sc_S1 touches
    // the slot, so park 0 looks idle -- until park 1's own spill is counted as
    // the read of the slot that it is.
    const src = body(
      DISPATCH(0, 1),
      ["sc_S0:", "  store double 1.000000e+00, ptr %sl", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  br label %p1"].join("\n"),
      ["p1:", spill(1), "  ret void"].join("\n"),
      ["sc_S2:", reload(1), "  %u = load double, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 2)].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test("...and the chain BREAKS at a store, so park 0 is not paid for", () => {
    // ARMED, the other way. The only difference from the case above is the
    // store in sc_S1. If the chain never broke, this would answer [0,1] too
    // and the result would be "carry everything" wearing a fixpoint.
    const src = body(
      DISPATCH(0, 1),
      ["sc_S0:", "  store double 1.000000e+00, ptr %sl", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  store double 5.000000e+00, ptr %sl", "  br label %p1"].join("\n"),
      ["p1:", spill(1), "  ret void"].join("\n"),
      ["sc_S2:", reload(1), "  %u = load double, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 2)]).toEqual([1]);
  });

  test("a slot whose address escapes after the park IS carried", () => {
    // Nothing can be concluded through a derived pointer -- the callee may
    // read it -- so an escape counts as a use and the carry stays. Contrast
    // the first case, whose sc_S1 differs from this one only in what it does
    // with the slot.
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  call void @sink(ptr %sl)", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 1)]).toEqual([0]);
  });

  test("an escape BEFORE a park does not pay for that park", () => {
    // THE MEASURED CORRECTION TO THIS FILE'S FIRST DRAFT, kept because the
    // wrong expectation was mine and not the analysis's. The escape sits in
    // sc_S1, which runs BEFORE park 1; after park 1 the slot is only written.
    // An alloca is resume-call-private machine stack memory of ONE resume
    // call, so nothing the callee kept can be read across the park either.
    const src = body(
      DISPATCH(0, 1),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  call void @sink(ptr %sl)", "  br label %p1"].join("\n"),
      ["p1:", spill(1), "  ret void"].join("\n"),
      ["sc_S2:", reload(1), "  store double 5.000000e+00, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    expect([...ask(src, 2)]).toEqual([0]);
  });

  test("a terminator form the reader does not know DECLINES", () => {
    // Declining means the caller carries everything, which is every base
    // before this one. It must not mean "nothing is live".
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  indirectbr ptr %x, [ label %done ]"].join("\n"),
      ["done:", "  ret void"].join("\n"),
      BAD,
    );
    expect(slotCarryLiveness(src, ["%sl"], 1)).toBeNull();
  });

  test("a state with no resume label DECLINES rather than guessing", () => {
    const src = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  ret void"].join("\n"),
      BAD,
    );
    expect(slotCarryLiveness(src, ["%sl"], 2)).toBeNull();
  });
});

describe("the re-emission control", () => {
  test("withoutSlotCarry strikes the carry and nothing else", () => {
    const full = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", spill(0), "  ret void"].join("\n"),
      ["sc_S1:", reload(0), "  %u = load double, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    const narrowed = body(
      DISPATCH(0),
      ["sc_S0:", "  br label %p0"].join("\n"),
      ["p0:", "  ret void"].join("\n"),
      ["sc_S1:", "  %u = load double, ptr %sl", "  ret void"].join("\n"),
      BAD,
    );
    // The point of the control: these two differ by six lines and by nothing
    // else, and the comparison says so.
    expect(withoutSlotCarry(full)).toBe(withoutSlotCarry(narrowed));
    expect(full).not.toBe(narrowed);
    expect(full.split("\n").length - narrowed.split("\n").length).toBe(6);
    // And it is not vacuous: a body that differs OUTSIDE the carry stays
    // different after the strike.
    expect(withoutSlotCarry(full)).not.toBe(
      withoutSlotCarry(full.replace("%u = load double, ptr %sl", "%u = load double, ptr %other")),
    );
  });
});
