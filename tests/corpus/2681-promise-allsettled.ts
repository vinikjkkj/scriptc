// Promise.allSettled, and the mapping that makes it mean anything.
//
// PromiseSettledResult<T>'s two parts used to intern one shared
// `{ status: string }` -- the honest subset -- so `value` and `reason` could
// not be read at all. They map WHOLE now: a `void` value is the unit it
// actually settles with, and an `any` reason is the checked-dynamic value it
// already is in the static tier. Keeping the arms apart is what makes the
// union a real discriminated pair.
//
// Each entry is wrapped into a promise that CANNOT reject before the
// combinator runs. Awaiting them in sequence instead would build the same
// array, but an entry rejecting while an earlier one is still pending would
// sit unhandled until its turn -- which Node reports.
async function ok(n: number): Promise<number> {
  return n;
}
async function bad(tag: string): Promise<number> {
  throw new Error(tag);
}
async function voided(): Promise<void> {}

async function main(): Promise<void> {
  const [a, b, c] = await Promise.allSettled([ok(1), bad("boom"), ok(3)]);
  console.log(a.status === "fulfilled" ? `f${a.value}` : "?");
  console.log(b.status === "rejected" ? `r:${b.reason instanceof Error ? b.reason.message : "?"}` : "?");
  console.log(c.status === "fulfilled" ? `f${c.value}` : "?");

  // A void-settling entry: `value` is the undefined it really settles with.
  const [v] = await Promise.allSettled([voided()]);
  console.log(v.status, v.status === "fulfilled" ? `${v.value}` : "?");

  // Every entry rejecting is still a FULFILLED allSettled -- the combinator
  // never sees a rejection because the wrappers absorb them.
  const [x, y] = await Promise.allSettled([bad("one"), bad("two")]);
  console.log(x.status, y.status);

  // The wrapper is interned per type pair, so a second site reuses it.
  const [again] = await Promise.allSettled([ok(9)]);
  console.log(again.status === "fulfilled" ? again.value : -1);
}

void main();
