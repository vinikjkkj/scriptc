// A BRANCH RESULT IS A SLOT, and on the stackless lane a slot that is live
// across a suspension has to live in the coroutine frame.
//
// `ternary`, `logical`, `nullish`, `orDefault`, `unionDisc` and
// `unionKeyGet` do not mint their result through the emitter's `newTemp`:
// the slot is DECLARED before the arms and WRITTEN inside them, so there is
// no initializer to mint it from. All of them registered the slot in the
// statement frame only when it was refcounted -- ownership bookkeeping,
// which is what the frames were originally for -- and the frames are also
// the register of what a park must spill. A SCALAR branch result was
// therefore invisible to the spill: a C local in the resume function, which
// returns to the scheduler, with the resume `goto` jumping over its
// declaration.
//
// Every line below puts such a slot in an argument list BESIDE an await, so
// the slot is written before the park and read after it. What a missing
// spill produces is not a crash and not a missing line -- it is a plausible
// wrong number (`awaited 0 8`), or a denormal that reads as a typo
// (3.56684903562e-312), or `false` for a `true` the program computed before
// the park. 7470 is where this was caught, through the one spelling nobody
// would look for: `await` of a `T | PromiseLike<T>` lowers to a TERNARY, so
// two of them in one argument list put the first one's result across the
// second one's park.
//
// The last two lines are the CONTROLS. They hold the same positions with no
// branch result in flight, so a break that is really about the argument
// position rather than the slot shows up there too.

function pos(n: number): boolean {
  return n > 0;
}

function maybe(n: number): number | null {
  return n > 0 ? n : null;
}

type Shape = { readonly kind: number } | { readonly kind: number; readonly extra: string };

function shape(n: number): Shape {
  return n === 0 ? { kind: 5 } : { kind: 6, extra: "x" };
}

async function pf(n: number): Promise<number> {
  return n + 1;
}

function joinN(a: number, b: number): number {
  return a * 1000 + b;
}

function joinB(a: boolean, b: number): number {
  return (a ? 1 : 2) * 1000 + b;
}

// `T | PromiseLike<T>` — the spelling that caught this. Both awaits lower to
// a ternary; the first one's result has to survive the second one's park.
function settleOrValue(which: number): number | PromiseLike<number> {
  return which === 0 ? 7 : Promise.resolve(8);
}

async function main(): Promise<void> {
  console.log("ternary", joinN(pos(1) ? 7 : 9, await pf(3)));
  console.log("logical", joinB(pos(1) && pos(2), await pf(3)));
  console.log("nullish", joinN(maybe(8) ?? 5, await pf(3)));
  console.log("ordeflt", joinN(maybe(6) || 5, await pf(3)));
  const s = shape(0);
  console.log("uniondisc", joinN(s.kind, await pf(3)));

  // The PromiseLike pair, both arms, in one argument list.
  const a = settleOrValue(0);
  const b = settleOrValue(1);
  console.log("promiselike", await a, await b);

  // ...and the same pair with the suspending arm FIRST, so the surviving
  // slot is the one the park arm wrote rather than the one the hop arm did.
  const c = settleOrValue(1);
  const d = settleOrValue(0);
  console.log("promiselike2", await c, await d);

  // CONTROLS: the same argument positions with the await FIRST, and with a
  // refcounted sibling. Both were always right and must stay right.
  console.log("ctl-await-first", joinN(await pf(3), 7));
  console.log("ctl-refcounted", (pos(1) ? "yes" : "no") + ":" + String(await pf(3)));
  console.log("done");
}

void main();
