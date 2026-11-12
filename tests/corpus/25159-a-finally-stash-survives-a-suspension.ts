// Distilled from tests/harness/stackless-finally-stash.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
/* One stash: a yield inside a finally, reached by .return() on a suspended
 * generator -- the finally runs with a return completion in flight. */
function* gStash(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("fin-a");
    yield 2;
    console.log("fin-b");
  }
  return 0;
}
const a = gStash();
a.next();
const ar = a.return(9);
console.log("a1", ar.done === true, ar.value as number);
const ar2 = a.next();
console.log("a2", ar2.done === true, ar2.value as number);

/* TWO regions, nested: a park inside the inner region must carry the outer
 * stash too, or the outer re-raise reads a dead slot. */
function* gNest(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("outer-in");
    try {
      yield 2;
    } finally {
      console.log("inner-in");
      yield 3;
      console.log("inner-out");
    }
    console.log("outer-out");
  }
  return 0;
}
const b = gNest();
b.next();
const br = b.return(11);
console.log("b1", br.done === true, br.value as number);
const br2 = b.next();
console.log("b2", br2.done === true, br2.value as number);
const br3 = b.next();
console.log("b3", br3.done === true, br3.value as number);

/* The stash re-raised as a THROW after the park, not as a return completion:
 * .throw() at the parked yield unwinds into the finally, which yields again,
 * and the error only surfaces at the next() that drains it. */
function* gThrow(): Generator<number, number, unknown> {
  try {
    yield 1;
  } finally {
    console.log("t-in");
    yield 2;
    console.log("t-out");
  }
  return 0;
}
const c = gThrow();
c.next();
try {
  c.throw(new Error("boom"));
} catch (e) {
  if (e instanceof Error) console.log("c-early", e.message);
}
console.log("c-parked");
try {
  const cr = c.next();
  console.log("c1", cr.done === true, cr.value as number);
} catch (e) {
  if (e instanceof Error) console.log("c-raised", e.message);
}
console.log("done");
