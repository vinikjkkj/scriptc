// The shapes a get/set accessor in a CHECKED-DYNAMIC object literal still
// refuses BY NAME. Everything else about the form lowers: the accessor
// becomes one dyn.defineProp carrying the literal's own enumerable,
// configurable descriptor. What is left is the set of cases where the fold
// would put the key in a POSITION, or under a DEFINITION RULE, that Node
// does not — each loud rather than answered.
//
// A key spelled BOTH as an accessor and as a data member is fenced too, but
// it cannot appear here: TypeScript's own checker rejects "an object literal
// cannot have property and accessor with the same name" first, in every
// spelling including a computed string-literal key. That fence is a
// defensive boundary, not a reachable diagnostic.
function take(o) { return o; }

// A SPREAD in the same literal. The spread's keys cannot be named here, so a
// collision with the accessor's key cannot be ruled out — and on a collision
// Node redefines the property IN PLACE while the accessor installer drops the
// member and re-adds a slot at the END.
const src = { z: 1 };
const spread = take({ ...src, get k() { return 2; } });
console.log(String(spread));

// A COMPUTED accessor key. Its position among the data keys, and its
// collisions, are the same unknowable question, and the key expression would
// additionally have to evaluate at the accessor's own point in source order.
function computed(key) {
  const o = { get [key]() { return 1; }, a: 2 };
  return JSON.stringify(o);
}
console.log(computed("q"));

// A RUN-TIME-KEYED member beside an accessor: the same question from the
// other side.
function runtimeKeyed(key) {
  const o = { [key]: 1, get b() { return 2; } };
  return JSON.stringify(o);
}
console.log(runtimeKeyed("q"));

// `this` under an ENCLOSING receiver: resolveThis answers the method's own
// `this` local before the ambient receiver read is reached, so the getter
// would silently read the OUTER object. Without an enclosing receiver `this`
// lowers, and is the object the accessor is read through.
class Holder {
  constructor() { this.v = 1; }
  build() { return take({ get b() { return this.v; } }); }
}
console.log(String(new Holder().build().b));

// The message this site is LEFT with, and the only construct it still names:
// a SPREAD on the road that carries a whole literal in. A literal in a dyn
// slot, or one spreading a checked-dynamic member chain, routes to the spread
// folder instead and never reaches here.
function spreadUnderRuntimeKey(key, src) {
  const o = { [key]: 1, ...src };
  return JSON.stringify(o);
}
console.log(spreadUnderRuntimeKey("q", { z: 9 }));

// `this` carried into a nested FUNCTION or ARROW. Only the accessor's own
// body reads the receiver the runtime pushes for it, and the two nested
// forms fail in opposite directions. An ARROW is a VALUE the accessor can
// return, store or defer, and the receiver is popped when the accessor
// returns: measured before the fence, Node answered 7 and both backends
// threw `Cannot read properties of undefined`. A plain FUNCTION has its
// OWN `this` in JS but runs while the push is still standing, so the
// ambient read hands it the ACCESSOR'S receiver: measured, `this === self`
// answered false in Node and true on both backends, at exit 0.
const escaping = take({ a: 7, get f() { return () => this.a; } });
console.log(String(escaping.f()));

const nestedFn = take({ a: 7, get g() { const f = function () { return this; }; return f(); } });
console.log(String(typeof nestedFn.g));
