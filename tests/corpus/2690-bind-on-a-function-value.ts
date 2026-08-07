// `f.bind(thisArg)` on a function VALUE, which a lock wrapper writes when it
// re-exposes a store's method.
//
// In TYPESCRIPT it is ERASURE, and here the reason holds: `this` in a plain
// TypeScript function does not compile at all (noImplicitThis is tsc's error
// and SC1080 is the lowerer's), so no TypeScript function value can observe a
// bound receiver and `f` really is `f.bind(x)`. The receiver is the answer;
// the argument still evaluates for its effects (the last case pins that).
//
// JAVASCRIPT is the opposite and 2767 is where it lives: a plain JS function's
// `this` IS a runtime read, so the same erasure was a silent wrong answer
// there and the bind now builds a real bound function.
//
// Extra arguments are partial application, which in TypeScript keeps the
// fence -- not exercised here, since a corpus case only holds programs that
// compile.
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
