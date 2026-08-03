// A bigint arm inside a union -- the BOX side.
//
// ScrBigInt is a refcounted heap value and vAdapters has carried its
// scr_big_retain_v/scr_big_release_v pair since bigint existed, but the
// kind was absent from isRefCounted, which is the list the unionWrap
// branch consults. Building the box died in the emitter ("unionWrap of
// bigint") -- not a fence, a crash, and the first thing zapo's codegen
// hit once its frontend cleared.
//
// Reading an arm back out through `typeof v === "bigint"` still fences
// (SC1090, typeof on a statically-typed value), so this case stays on the
// construction, storage and drop paths: that is exactly what the fix
// opens, and it is where a missing retain or a double release shows up.

function pick(which: number): bigint | string {
  if (which === 0) return 10n;
  if (which === 1) return "texto";
  return 9007199254740993n; // past Number.MAX_SAFE_INTEGER: a real bigint
}

const vals: (bigint | string)[] = [pick(0), pick(1), pick(2)];
console.log(vals.length);

// Boxes surviving a round trip through a container, so the retain on
// store and the release on drop both run against a real payload.
const held: (bigint | string)[] = [];
for (let i = 0; i < 50; i++) held.push(pick(i % 3));
console.log(held.length);

// Reassigning over a live box drops the old payload -- the path a leak or
// a double-free shows up on. Alternating arms means every drop is a
// different kind from the one replacing it.
let slot: bigint | string = 1n;
for (let i = 0; i < 20; i++) slot = i % 2 === 0 ? BigInt(i) : "s" + i;
console.log(held.length, vals.length);

// A unit arm beside the bigint one: undefined interns, the bigint
// allocates, and both live in the same union.
function maybe(on: boolean): bigint | undefined {
  return on ? 42n : undefined;
}
const opts = [maybe(true), maybe(false), maybe(true)];
console.log(opts.length);

// The payload itself, off the union, so the digits are actually observed
// rather than only allocated. Kept in a scalar rather than a bigint[]:
// arrays of bigint are their own emitter gap ("array of bigint"), the
// sibling of this one and not what this case is about.
let total = 0n;
for (let i = 0; i < 5; i++) total += BigInt(i) * 1000000007n;
console.log(total.toString());
