// `f.bind(thisArg)` on a function VALUE, which a lock wrapper writes when it
// re-exposes a store's method.
//
// It is ERASURE, for the reason the fence itself used to give: a compiled
// function value carries no runtime `this` to re-route, so binding one cannot
// change what a call does. The receiver is the answer; the argument still
// evaluates for its effects (the last case pins that).
//
// Extra arguments are partial application, not erasure, and keep the fence --
// not exercised here, since a corpus case only holds programs that compile.
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
