// The LABELED-JUMP CARVE-OUT of IteratorClose, on both generator flavours.
//
// A for-of / for-await over a generator closes the iterator from a FINALLY
// wrapped around the loop, so every abrupt completion runs the generator's
// cleanup (5933 scores that). One body shape cannot have that wrap: a
// `break lbl` / `continue lbl` that LEAVES the loop would then cross a
// finally, and only `return` has the backend's pending-action plumbing --
// so such a body keeps the legacy placement, with the close sitting after
// the loop where an escaping labeled jump skips it. See
// hasEscapingLabeledJump in lower-generators.ts.
//
// This program is the carve-out's own test, and it pins two separate facts.
//
// FIRST, that the shape still COMPILES and still matches Node. It is the
// shape of tests/corpus/2019-generators-loops.ts, which compiled and matched
// before any of this and had to keep doing so; wrapping it unconditionally
// refused it outright with SC1090.
//
// SECOND, what the carve-out actually costs, which is more than a missed
// `finally`. A generator abandoned mid-iteration keeps its suspended fiber:
// scr_gen_release deliberately does NOT unwind one (Node's GC does not run
// finallys either), so the stack and everything it owns stay live to exit.
// Under SCRIPTC_RC_AUDIT=1 this program therefore prints
//
//     scriptc RC audit skipped: 4 fiber(s) never resumed
//
// and the audit does not run at all -- which is exactly why this section is
// its OWN program rather than a section of 5933. Merged into 5933 it made
// THAT program's audit skip too, turning a lane that reported zero live
// objects into one that reported nothing and looked identical. 2019 has
// carried the same skip (2 fibers) since long before this branch.
//
// The generators below deliberately have NO `finally`: that is the
// condition under which the legacy placement is unobservable in output, and
// pinning it here says the divergence is confined to the fiber accounting.
async function* aplain(): AsyncGenerator<number, void, void> {
  yield 1;
  yield 2;
  yield 3;
}

function* splain(): Generator<number, void, void> {
  yield 1;
  yield 2;
  yield 3;
}

async function labeled(): Promise<void> {
  outer: for (const x of [10, 20, 30]) {
    for await (const v of aplain()) {
      if (v === 2 && x === 20) continue outer;
      if (x === 30) break outer;
      console.log("lab", x, v);
    }
  }
  souter: for (const x of [10, 20, 30]) {
    for (const v of splain()) {
      if (v === 2 && x === 20) continue souter;
      if (x === 30) break souter;
      console.log("slab", x, v);
    }
  }
}

labeled();
