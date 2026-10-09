/* The cross-park temp detector's own guard.
 *
 * WHY THIS FILE HAS TO EXIST, and it is not symmetry with size-class-armed.
 * The LLVM stackless lowering leans on ONE assertion for a whole class of
 * defect: no `%tN` minted before a park may be referenced after it. A park
 * terminates its block with `ret void` and the resume block that follows is
 * reachable only from the entry dispatch, so such a value does not dominate
 * its use and the module is malformed.
 *
 * THIS FILE USED TO SAY NOTHING ELSE ON THIS HOST WOULD CATCH IT. THAT WAS
 * WRONG, and the correction is kept here rather than dropped because it is the
 * paragraph that says why the file exists. `-disable-llvm-verifier` turns off
 * the verifier pass in the OPTIMISATION pipeline, not the check `zig cc` runs
 * when it PARSES `.ll`. Measured on a real emitted artifact, both directions:
 * unmodified it exits 0; with one arm of a two-armed suspension reading a
 * `%tN` the other arm defines it exits 1 with `invalid LLVM IR input:
 * Instruction does not dominate all uses!`.
 *
 * WHY THE EARLIER PROBE SAID OTHERWISE, because the discrepancy is the lesson.
 * It carried "a deliberate verifier-only defect" and did exit 0 -- but that
 * defect was dominance-LEGAL, and so is everything else the parse-time check
 * waves through. "The verifier is off" was generalised from one probe whose
 * defect was outside the only class the check actually covers.
 *
 * SO WHAT IS THIS FILE FOR, under the true premise? The emitter is not the
 * only thing standing between that class and the binary -- it is the thing
 * standing between that class and a FAILED BUILD. A shape the admission
 * predicate wrongly admits should keep its fiber lowering and cost coverage;
 * reaching `zig cc` and failing is the wrong outcome, not a safe one. That
 * makes "the emitter asserts it" and "the assertion still detects anything"
 * two INDEPENDENT claims, and covering only the first is the most convincing
 * way to cover nothing: the build is green, the lowering runs, and the
 * detector underneath may have stopped matching years ago. Two failures, not
 * one -- forgetting to arm, and arming a detector that rotted.
 *
 * AND THE SLOT HALF OF THIS FILE HAS NO BACKSTOP AT ALL. The dominance-legal
 * class -- a resume-call-private alloca read after a park -- is invisible to
 * the parse-time check by construction. Measured the same way: narrowing a
 * frame struct's last field from i64 to i32 under-allocates every frame and
 * compiles to exit 0 with no diagnostic.
 *
 * So: plant a violation and require a complaint back. These are pure-function
 * tests over BlockBuilder -- no compiler, no linker, no toolchain -- so they
 * run everywhere and nothing external can make them pass.
 */
import { describe, expect, test } from "vitest";
// The SOURCE module, by relative path -- the convention the other
// internals-facing harness tests use (dyn-dispatch-accounting, cc.ts). There
// is no package subpath export for backend internals, and there should not be.
import { BlockBuilder, CrossParkSlotError, CrossParkTempError } from "../../packages/compiler/src/backend/llvm/blocks.js";

/** The shape every case below is a variation on: mint a temp, suspend, and
 * then do something with the temp on the far side. `park` is what the await
 * lowering emits -- terminate the block and open the resume label -- and
 * `parkBoundary()` is the call that arms the rule for everything after it. */
function builderAtResume(): { B: BlockBuilder; t: string } {
  const B = new BlockBuilder();
  B.enterCoro("app.handleMessage");
  const t = B.tmp();
  B.line(`${t} = call double @mk()`);
  B.terminate("ret void");
  B.startBlock("sc_S1");
  B.parkBoundary();
  return { B, t };
}

describe("the cross-park temp detector is armed", () => {
  test("a PLANTED VIOLATION -- a temp read after a park -- throws, and names it", () => {
    const { B, t } = builderAtResume();
    let err: unknown = null;
    try {
      B.line(`call void @use(double ${t})`);
    } catch (e) {
      err = e;
    }
    expect(err, "a temp used after a park must not pass silently").toBeInstanceOf(
      CrossParkTempError,
    );
    const m = (err as Error).message;
    // It must say WHICH temp, in WHICH function, in WHICH block, and what to
    // do -- the four things a bare "malformed module" never says, and the
    // reason a reader can act on this without reading the emitter.
    expect(m).toContain(t);
    expect(m).toContain("app.handleMessage");
    expect(m).toContain("sc_S1");
    expect(m).toContain("Spill");
  });

  test("a violation in a TERMINATOR is caught too, not only in a line", () => {
    // `terminate()` takes arbitrary text and is how the switch, the branches
    // and every `ret` are emitted -- a rule that scanned only `line()` would
    // be blind to `ret double %t0`, which is exactly the last thing a resume
    // body does with a value.
    const { B, t } = builderAtResume();
    expect(() => B.terminate(`ret double ${t}`)).toThrow(CrossParkTempError);
  });

  test("the CORRECT lowering passes -- spill, park, reload into a FRESH temp", () => {
    // Without this the rule could be trivially red and still look armed.
    const B = new BlockBuilder();
    B.enterCoro("app.handleMessage");
    const t0 = B.tmp();
    B.line(`${t0} = call double @mk()`);
    B.line(`store double ${t0}, ptr %frameslot`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    const t1 = B.tmp();
    B.line(`${t1} = load double, ptr %frameslot`);
    expect(() => B.line(`call void @use(double ${t1})`)).not.toThrow();
  });

  test("a temp minted BEFORE the park and read BEFORE it is fine", () => {
    // The rule is about crossing the boundary, not about the temp's age.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const t = B.tmp();
    B.line(`${t} = call double @mk()`);
    expect(() => B.line(`call void @use(double ${t})`)).not.toThrow();
  });

  test("a REGISTERED alloca slot read across a park is caught, and named", () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the inversion is the point of
    // the slice that changed it. It read "DECLARED NON-COVERAGE, demonstrated:
    // an alloca SLOT is not caught", and it was right: `%sN` is machine-stack
    // memory of the resume CALL, dominance-LEGAL, so neither the `%t` rule nor
    // a working verifier would ever report it.
    //
    // It stopped being acceptable when the cross-park TEMP mechanism landed.
    // Admitting the shapes that carry a value across a park admits the forOf
    // loops, whose cursor is exactly this: a slot initialised in `sc_S0`, which
    // a resume jumps past, and re-read by the latch. The temp rule would have
    // reported the iterable and said nothing about the cursor -- so opening the
    // named blocker would have left a SILENT wrong answer behind it, in six
    // corpus wrappers. The rule below refuses instead of repairing: carrying a
    // slot means moving it into the frame, which is a different mechanism.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const s = B.slot();
    B.entryAllocas.push(`${s} = alloca double`);
    B.line(`store double 1.0, ptr ${s}`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    let err: unknown = null;
    try {
      B.line(`%r = load double, ptr ${s}`);
    } catch (e) {
      err = e;
    }
    expect(err, "a slot read across a park must not pass silently").toBeInstanceOf(
      CrossParkSlotError,
    );
    const m = (err as Error).message;
    expect(m).toContain(s);
    expect(m).toContain("f");
    expect(m).toContain("sc_S1");
  });

  test("a slot RE-WRITTEN after the park is fine -- the rule is about the value, not the name", () => {
    // Without this the slot rule could be trivially red and still look armed,
    // and it would refuse two correct corpus shapes. A ternary whose NON-await
    // arm wrote the join slot before the park is not broken: that arm never
    // parks, and the awaiting arm writes the slot after its own resume. The
    // rule is "read with no write in this generation", not "mentioned on both
    // sides" -- the cheaper spelling refuses `pick ? 7 : await p()`.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const s = B.slot();
    B.entryAllocas.push(`${s} = alloca double`);
    B.line(`store double 1.0, ptr ${s}`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    B.line(`store double 2.0, ptr ${s}`);
    expect(() => B.line(`%r = load double, ptr ${s}`)).not.toThrow();
  });

  test("DECLARED NON-COVERAGE, demonstrated: an UNREGISTERED alloca is still not caught", () => {
    // The slot rule is bounded to the allocas this emitter REGISTERS as
    // resume-call-private -- everything `slot()` mints, plus the log-argument
    // array. An alloca pushed straight into `entryAllocas` under a name of its
    // own is outside the registry and is not seen.
    //
    // Demonstrated rather than asserted in a comment, because "what this does
    // not cover" is the half of a detector that rots unnoticed -- and because
    // the general classification of every alloca site in the backend is a
    // DIFFERENT, wider decision that this slice deliberately did not take. A
    // reader who sees the two planted violations above go red must not
    // conclude the emission is verified; it means two rules hold.
    const B = new BlockBuilder();
    B.enterCoro("f");
    B.entryAllocas.push(`%adhoc = alloca double`);
    B.line(`store double 1.0, ptr %adhoc`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    expect(() => B.line(`%r = load double, ptr %adhoc`)).not.toThrow();
  });

  test("KNOB ABSENT -- a builder that never entered a coro is inert", () => {
    // Every function on a knob-absent build takes this path, so the rule must
    // cost nothing and refuse nothing there.
    const B = new BlockBuilder();
    const t = B.tmp();
    B.line(`${t} = call double @mk()`);
    B.terminate("ret void");
    B.startBlock("whatever");
    expect(() => B.line(`call void @use(double ${t})`)).not.toThrow();
  });

  test("the boundary COUNT is what D5 asserts against, and it counts", () => {
    // emitFunction compares this against the number of states the body drew.
    // A park that drew a state without calling parkBoundary() would leave the
    // whole rule inert -- a counter reading zero mechanically -- so the count
    // has to be observable and not merely incremented.
    const B = new BlockBuilder();
    B.enterCoro("f");
    expect(B.boundaries()).toBe(0);
    B.parkBoundary();
    B.parkBoundary();
    expect(B.boundaries()).toBe(2);
  });

  test("the switch terminator spells a dispatch the assembler accepts", () => {
    const B = new BlockBuilder();
    B.switchTerm("%st", "sc_dispatch_bad", [
      [0, "sc_S0"],
      [1, "sc_S1"],
    ]);
    B.startBlock("sc_S0");
    B.terminate("ret void");
    expect(B.render()).toContain(
      "switch i32 %st, label %sc_dispatch_bad [ i32 0, label %sc_S0 i32 1, label %sc_S1 ]",
    );
  });
});
