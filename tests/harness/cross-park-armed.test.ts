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
import {
  BlockBuilder,
  CrossParkSlotError,
  CrossParkTempError,
  type CoroViolations,
} from "../../packages/compiler/src/backend/llvm/blocks.js";

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

  /* ── THE RULE'S FALSE POSITIVES, and the CFG that decides them ────────
   *
   * The two tests below are the pair. The rule is ORDERED BY EMISSION: it asks
   * whether a line was appended after the generation counter passed the temp's
   * minting generation. The question it stands in for is whether the use can
   * execute on a resume call that did not also execute the definition -- a
   * REACHABILITY question. The two disagree whenever a block is appended after
   * a resume label and branched into from before it, which is what `a ?? (await
   * b)` emits for its non-nullish arm.
   *
   * AND THE DISAGREEMENT IS NOT FREE. The repair for a flagged temp RENAMES
   * every later-appended use into the resume block's reload, so a flag on a
   * use the definition already dominated replaces it with one the reload does
   * not -- and the module stops verifying. That is not a thought experiment:
   * tests/corpus/3492-nullish-retag-await-default.ts failed to build with four
   * "Instruction does not dominate all uses!" until the prune landed.
   *
   * BOTH DIRECTIONS OR NEITHER. A prune that dropped everything would make the
   * first test pass and be catastrophic, so the second plants a REAL crossing
   * in the same shape and requires it to survive. */
  function collector(): CoroViolations {
    return { temps: new Map(), slots: new Map(), exempt: new Set() };
  }

  test("a SIBLING ARM the dispatch cannot reach is pruned, not carried", () => {
    const B = new BlockBuilder();
    B.enterCoro("f");
    const v = collector();
    B.collectInto(v);
    const t = B.tmp();
    B.line(`${t} = call ptr @mk()`);
    // The pre-park test: one arm parks, the other does not.
    B.condBr("%c", "nul.u", "nul.v");
    B.startBlock("nul.u");
    B.terminate("ret void");
    // The resume label. Everything appended from here is a LATER generation.
    B.startBlock("sc_S1");
    B.parkBoundary();
    B.br("nul.j");
    // ...including `nul.v`, whose ONLY predecessor is the pre-park block.
    B.startBlock("nul.v");
    B.line(`call void @use(ptr ${t})`);
    B.br("nul.j");
    B.startBlock("nul.j");
    B.terminate("ret void");

    // The ordinal rule flagged it, which is the thing being corrected.
    expect([...v.temps.keys()], "the ordinal rule must flag it -- that is the premise").toContain(t);
    B.pruneUnreachableCrossPark(v);
    expect([...v.temps.keys()], "the CFG says the dispatch cannot reach nul.v").not.toContain(t);
    expect([...v.exempt]).toContain(t);
  });

  test("a REAL crossing in the SAME shape survives the prune", () => {
    // Identical to the test above except for WHERE the use sits: inside the
    // block the dispatch enters. If the prune were keyed on anything but
    // reachability this would be dropped too, and dropping it is silent
    // corruption rather than a loud one.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const v = collector();
    B.collectInto(v);
    const t = B.tmp();
    B.line(`${t} = call ptr @mk()`);
    B.condBr("%c", "nul.u", "nul.v");
    B.startBlock("nul.u");
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    B.line(`call void @use(ptr ${t})`);
    B.br("nul.j");
    B.startBlock("nul.v");
    B.br("nul.j");
    B.startBlock("nul.j");
    B.terminate("ret void");

    expect([...v.temps.keys()]).toContain(t);
    B.pruneUnreachableCrossPark(v);
    expect([...v.temps.keys()], "a use IN the resume block is a real crossing").toContain(t);
    expect([...v.exempt]).not.toContain(t);
  });

  test("a use reachable from the resume label only THROUGH another block survives", () => {
    // The prune walks successors to a fixpoint rather than looking at the
    // resume block alone, so a crossing two edges away is still a crossing.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const v = collector();
    B.collectInto(v);
    const t = B.tmp();
    B.line(`${t} = call ptr @mk()`);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    B.br("k0");
    B.startBlock("k0");
    B.br("k1");
    B.startBlock("k1");
    B.line(`call void @use(ptr ${t})`);
    B.terminate("ret void");

    B.pruneUnreachableCrossPark(v);
    expect([...v.temps.keys()], "two edges from the resume label is still reachable").toContain(t);
    expect([...v.exempt]).not.toContain(t);
  });

  /* THE THIRD FATE OF A FLAG, and the one neither test above covers.
   *
   * The pair above splits every flagged use in two: the dispatch can reach it
   * (carry it) or it cannot (exempt it). That split is EXHAUSTIVE over the
   * question it asks and silently incomplete over the one that matters,
   * because "reachable from the dispatch" and "dominated by the reload" are
   * not the same predicate. A use in the JOIN of the two arms is reachable
   * from the dispatch -- through the resume label -- AND reachable from the
   * entry arm, which never passed the resume label at all. The prune keeps it,
   * the reload is installed in `sc_S1`, and the join reads a value that is not
   * defined on one of its two predecessors.
   *
   * MEASURED, AND IT IS WHY THIS PAIR EXISTS. `args.iv ?? (await f())` emits
   * exactly this when the left of the `??` is a MEMBER ACCESS: the receiver is
   * retained before the branch and RELEASED in the join, so the join holds a
   * use the resume block cannot cover. That is the difference from
   * tests/corpus/3492-nullish-retag-await-default.ts, whose `??` lefts are all
   * bare locals -- no retain, no release, no use in the join -- which is why
   * the prune alone was enough for it and was not enough for app182. zig cc
   * rejected seven of that program's functions with
   * "Instruction does not dominate all uses!" on the shipping default.
   *
   * BOTH DIRECTIONS, for the same reason the prune pair has both: a check that
   * answered "offender" for every carried temp would make the first test pass
   * and refuse the whole lane, so the second requires a sound carry to come
   * back clean. */
  /** The shape both tests below vary: an entry dispatch, a value minted on the
   * entry arm, a two-armed suspension where only ONE arm parks, and a join. */
  function joinBuilder(useInJoin: boolean): { B: BlockBuilder; t: string; fresh: string } {
    const B = new BlockBuilder();
    B.enterCoro("f");
    B.terminate("switch i32 %st, label %bad [ i32 0, label %sc_S0 i32 1, label %sc_S1 ]");
    B.startBlock("bad");
    B.terminate("unreachable");
    B.startBlock("sc_S0");
    const t = B.tmp();
    B.line(`${t} = call ptr @mk()`);
    B.condBr("%c", "nul.u", "nul.v");
    // The parking arm: spill and return to the scheduler.
    B.startBlock("nul.u");
    B.line(`store ptr ${t}, ptr %cxs0`);
    B.terminate("ret void");
    // The resume label, and the reload the carry installs in it.
    B.startBlock("sc_S1");
    B.parkBoundary();
    const fresh = "%cx0_t0";
    B.line(`${fresh} = load ptr, ptr %cxr0`);
    B.renameTemp(t, fresh);
    if (!useInJoin) {
      // A use IN the resume block, which the same-block rule covers...
      B.line(`call void @release(ptr ${t})`);
      // ...and one a block FURTHER ON, which only real dominance covers.
      // Without this second use the clean direction would pass on the
      // shortcut alone and say nothing about the dominator walk.
      B.br("k0");
      B.startBlock("k0");
      B.line(`call void @trace(ptr ${t})`);
    }
    B.br("nul.j");
    // The NON-parking arm, which reaches the join without passing sc_S1.
    B.startBlock("nul.v");
    B.br("nul.j");
    B.startBlock("nul.j");
    // `line()` applies the rename before anything else sees the text, so this
    // arrives in the join spelled as the reload -- which is the defect.
    if (useInJoin) B.line(`call void @release(ptr ${t})`);
    B.terminate("ret void");
    return { B, t, fresh };
  }

  test("a carry whose reload cannot cover the JOIN is reported, and names the origin", () => {
    const { B, t, fresh } = joinBuilder(true);
    // The premise: the use really did arrive spelled as the reload. Without
    // this the test could pass on a body where the rename never applied.
    expect(B.render(), "the join must hold the RELOAD's name, not the origin's").toContain(
      `call void @release(ptr ${fresh})`,
    );
    expect(
      B.carryDominanceOffender(),
      "nul.v reaches nul.j without passing sc_S1, so the reload does not define it",
    ).toBe(t);
  });

  test("a carry used ONLY past the resume label comes back clean", () => {
    // Identical except for WHERE the use sits. If the check were keyed on
    // anything but entry-arm reachability this would be reported too, and
    // reporting it costs every sound carry a needless frame slot -- or, when
    // the type cannot be read, the function's whole lowering.
    const { B } = joinBuilder(false);
    expect(
      B.carryDominanceOffender(),
      "a use inside the resume region is exactly what the carry is for",
    ).toBeNull();
  });

  test("an EXEMPT origin is no longer flagged at all", () => {
    // What the fixpoint installs on the pass that counts. Without this the
    // second probe pass would re-raise every pruned flag and the emitter would
    // read the re-raise as a new violation.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const t = B.tmp();
    B.line(`${t} = call ptr @mk()`);
    B.exemptCrossPark(t);
    B.terminate("ret void");
    B.startBlock("sc_S1");
    B.parkBoundary();
    expect(() => B.line(`call void @use(ptr ${t})`)).not.toThrow();
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
    // THE EAGER SPELLING, which no resume body uses any more -- the emitter
    // defers its dispatch (see the three tests below). It is still the one
    // place the switch TEXT is pinned, and the deferred path is asserted to
    // produce the same text, so this stays rather than becoming a spelling
    // test for a method production stopped calling.
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

  /* THE DEFERRED DISPATCH -- what a resume body actually emits.
   *
   * The entry block is held open while the body is walked, because how many
   * states the body emits is not known until it HAS been walked: a `finally`
   * body is written once per completion path, so one plan point becomes
   * several states and several resume labels. These three drive BlockBuilder
   * directly, with no compiler and no toolchain, for the same reason the rest
   * of this file does -- a mechanism that exists to catch something else needs
   * a companion proving it still works. */
  test("the DEFERRED dispatch lands in the ENTRY block with the same spelling", () => {
    const B = new BlockBuilder();
    B.enterCoro("f");
    const st = B.tmp();
    B.line(`${st} = load i32, ptr %sc_b`);
    B.deferDispatch();
    B.startBlock("sc_dispatch_bad");
    B.terminate("unreachable");
    B.startBlock("sc_S0");
    B.terminate("ret void");
    // TWO resume labels, which is the case the eager form could not serve:
    // the arm count is known only here, after the body.
    B.startBlock("sc_S1");
    B.parkBoundary();
    B.terminate("ret void");
    B.startBlock("sc_S2");
    B.parkBoundary();
    B.terminate("ret void");
    B.finishDispatch(st, "sc_dispatch_bad", [
      [0, "sc_S0"],
      [1, "sc_S1"],
      [2, "sc_S2"],
    ]);
    const out = B.render();
    expect(out).toContain(
      `switch i32 ${st}, label %sc_dispatch_bad [ i32 0, label %sc_S0 i32 1, label %sc_S1 i32 2, label %sc_S2 ]`,
    );
    // IN THE ENTRY BLOCK, not appended at the end: the terminator has to close
    // the block the state was loaded in, or the resume labels are unreachable.
    const entry = out.slice(0, out.indexOf("sc_dispatch_bad:"));
    expect(entry).toContain("switch i32 ");
  });

  test("a resume body whose dispatch was never finished does not render", () => {
    // The failure this forbids is silent downstream: the entry block would
    // print `unreachable` where the switch belongs, every resume label would
    // be unreachable, and the module would still verify, link and run --
    // answering correctly on its first turn and never resuming.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const st = B.tmp();
    B.line(`${st} = load i32, ptr %sc_b`);
    B.deferDispatch();
    B.startBlock("sc_S0");
    B.terminate("ret void");
    expect(() => B.render()).toThrow(/dispatch was never finished/);
  });

  test("the dispatch value may not be minted after a boundary", () => {
    // finishDispatch runs after the walk, when the rename and promotion maps
    // have moved on, so it applies none of them -- and that is sound only
    // because the value it switches on is loaded in the entry block, in
    // generation 0. This is the check that keeps it sound.
    const B = new BlockBuilder();
    B.enterCoro("f");
    const early = B.tmp();
    B.line(`${early} = load i32, ptr %sc_b`);
    B.deferDispatch();
    B.startBlock("sc_S1");
    B.parkBoundary();
    const late = B.tmp();
    B.line(`${late} = load i32, ptr %sc_b`);
    expect(() => B.finishDispatch(late, "sc_dispatch_bad", [[0, "sc_S0"]]))
      .toThrow(/generation 1/);
  });
});
