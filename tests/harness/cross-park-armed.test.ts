/* The cross-park temp detector's own guard.
 *
 * WHY THIS FILE HAS TO EXIST, and it is not symmetry with size-class-armed.
 * The LLVM stackless lowering leans on ONE assertion for a whole class of
 * defect: no `%tN` minted before a park may be referenced after it. A park
 * terminates its block with `ret void` and the resume block that follows is
 * reachable only from the entry dispatch, so such a value does not dominate
 * its use and the module is malformed.
 *
 * On a normal host `llvm-as` would say so. On THIS one nothing does. `zig cc`
 * passes `-disable-llvm-verifier` to cc1, which was measured rather than
 * assumed: a probe carrying a deliberate verifier-only defect compiled to
 * exit 0 with no diagnostic, while a PARSER error in the same harness
 * correctly exited 1. So the module is never verified; at -O0 the defect
 * reads a spill slot never written on that path, and at -O2 the optimiser
 * EXPLOITS the undefined value -- it folded the probe's two blocks together
 * and tail-called with whatever happened to be in %rax. Exit 0 both times.
 *
 * The emitter is therefore the only thing standing between that class and the
 * binary. Which makes "the emitter asserts it" and "the assertion still
 * detects anything" two INDEPENDENT claims, and covering only the first is the
 * most convincing way to cover nothing: the build is green, the lowering runs,
 * and the detector underneath may have stopped matching years ago. Two
 * failures, not one -- forgetting to arm, and arming a detector that rotted.
 *
 * So: plant a violation and require a complaint back. These are pure-function
 * tests over BlockBuilder -- no compiler, no linker, no toolchain -- so they
 * run everywhere and nothing external can make them pass.
 */
import { describe, expect, test } from "vitest";
// The SOURCE module, by relative path -- the convention the other
// internals-facing harness tests use (dyn-dispatch-accounting, cc.ts). There
// is no package subpath export for backend internals, and there should not be.
import { BlockBuilder, CrossParkTempError } from "../../packages/compiler/src/backend/llvm/blocks.js";

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

  test("DECLARED NON-COVERAGE, demonstrated: an alloca SLOT is not caught", () => {
    // This is a REAL defect of the same family -- `%sN` is machine-stack
    // memory of the resume CALL, so a slot written before a park and read
    // after it reads garbage -- and the rule is blind to it BY CONSTRUCTION:
    // slots are `%s`, not `%t`, and they are dominance-LEGAL besides, so even
    // a working verifier would pass them.
    //
    // Demonstrated rather than asserted in a comment, because "what this does
    // not cover" is the half of a detector that rots unnoticed. A reader who
    // sees the planted violation above go red must not conclude the emission
    // is verified; it means ONE rule holds.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const s = B.slot();
    B.entryAllocas.push(`${s} = alloca double`);
    B.line(`store double 1.0, ptr ${s}`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    expect(() => B.line(`%r = load double, ptr ${s}`)).not.toThrow();
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
