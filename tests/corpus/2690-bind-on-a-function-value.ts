// `f.bind(thisArg)` on a function VALUE, which a lock wrapper writes when it
// re-exposes a store's method.
//
// THE RECEIVER IS STILL DROPPED IN TYPESCRIPT, AND THE VALUE IS STILL A NEW
// FUNCTION OBJECT. The two halves are separate and this file used to run them
// together. `this` in a plain TypeScript function does not compile at all
// (noImplicitThis is tsc's error and SC1080 is the lowerer's), so no
// TypeScript function value can observe a bound receiver and dropping it is
// sound -- that half is unchanged, and the argument still evaluates for its
// effects (the last case pins that). But `bind` does not only re-route a
// receiver, it CONSTRUCTS, and the erasure that dropped the receiver dropped
// the ALLOCATION with it: `plain.bind(null) === plain` printed `true` where
// every engine prints `false`. 6030 is where that identity now lives; here
// the wrapper is simply what these three programs compile through.
//
// JAVASCRIPT differs only in the receiver, and 2767 is where it lives: a plain
// JS function's `this` IS a runtime read, so the JS arm opens a `this` window
// around the wrapped call where the TypeScript arm opens none.
//
// Extra arguments are partial application, and they now compile on both arms
// over the same wrapper (`two.bind(null, 1)` in 6030); in TypeScript they used
// to keep the fence.
type Store = { readonly ttl: () => number; readonly name: string };
const impl: Store = { ttl: () => 42, name: "s" };

// A record's function field re-exposed through bind: the value carries no
// runtime `this`, so the bind is erasure.
const wrapped: Store = { ttl: impl.ttl.bind(impl), name: impl.name };
console.log(wrapped.ttl(), wrapped.name);

function plain(n: number): number { return n * 2; }
const bound = plain.bind(null);
console.log(bound(21));

// The argument still evaluates for its effects.
let seen = 0;
const eff = (): Store => { seen += 1; return impl; };
const b2 = impl.ttl.bind(eff());
console.log(b2(), seen);
