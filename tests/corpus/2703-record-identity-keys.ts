// A Set of RECORDS, and a Map keyed by them -- how a transport tracks its
// in-flight sockets.
//
// Class instances already keyed by reference identity (SCR_MAP_KEY_REF);
// records did not, and the reason looked principled: a record is COPIED by
// width coercion while a class instance never is, so hashing one by
// pointer seemed to invent a divergence.
//
// It does not, and the check is cheap: record identity is ALREADY
// observable and already JS-exact. `a === b` is false for two literals with
// equal fields, true through a binding or a parameter, and indexOf finds a
// value by reference while missing an equal-looking one -- all matching
// Node. The width copy changes identity in `===` exactly as it would here,
// which makes this the same documented divergence, not a new one.
//
// LLVM refuses this construct (SC3001) and the default build falls back to
// C. That refusal is deliberate: wiring the key-access suffix alone made it
// compile and SEGFAULT, so that side needs more than a name.

type Sock = { readonly id: number };
const pending = new Set<Sock>();
const a: Sock = { id: 1 };
const b: Sock = { id: 1 };
pending.add(a); pending.add(b); pending.add(a);
console.log(pending.size, pending.has(a), pending.has({ id: 1 }));
pending.delete(a);
console.log(pending.size, pending.has(a), pending.has(b));
const m = new Map<Sock, string>();
m.set(a, "A"); m.set(b, "B");
console.log(m.size, m.get(a), m.get(b), m.get({ id: 1 }));
