// npm-static pilot: OVERRIDING an inherited implicit-generic method — the
// one construct between mysql2 and a native binary
// (`lib/pool_connection.js:35`, `end(callback)` over
// `lib/base/connection.js:1097`).
//
// An untyped JS method monomorphizes per call-site argument tuple and owns
// no vtable slot, so dispatch is STATIC. That is exactly why the override
// is sound to admit and exactly why it needs proving: every call must
// reach the body its RECEIVER's class declares, the override must receive
// the arguments the base declared, and the value that comes back must be
// the override's, not the base's.
//
// Calls through a receiver whose runtime class the static type does not pin
// are a separate matter: they REFUSE by name (SC1090, pinned in
// tests/diagnostics/generic-override-inexact-receiver). This program only
// drives what compiles, and byte-matches Node on all of it.
import poolish from "poolish";

const seen: string[] = [];
const sink = (s: unknown): void => {
  seen.push(String(s));
};

// 1. The override's own receiver reaches the override.
const p = new poolish.Pooled("p1");
console.log(p.end(sink));
console.log("log=" + p.log);

// 2. The base's own receiver still reaches the base.
const b = new poolish.Base("b1");
console.log(b.end(sink));
console.log("log=" + b.log);

// 3. The MIDDLE class declares no `end`: it inherits the base's body.
const m = new poolish.Mid("m1");
console.log(m.end(sink));
console.log("log=" + m.log);

// 4. The argument the base declared is the argument the override receives,
//    and it is forwarded through `super.end` to the base body that calls it.
console.log("seen=" + seen.join("|"));

// 5. A SECOND instantiation of the same override, over a different argument
//    type tuple: no callback at all. Monomorphization keys on the argument
//    types, so this is a different instance of the same source body — and
//    `typeof callback === 'function'` has to answer false in it.
const p2 = new poolish.Pooled("p2");
console.log(p2.end(undefined));
console.log("log=" + p2.log);

// 6. The undefined-argument instance of the BASE body, reached through
//    `super` from instance 5 and directly here.
const b2 = new poolish.Base("b2");
console.log(b2.end(undefined));

// 7. A string argument: a third tuple, and one that is not callable.
const p3 = new poolish.Pooled("p3");
console.log(p3.end("not-a-function"));
console.log("log=" + p3.log);

// 8. The zero-parameter method is an ordinary VTABLE slot on the same
//    classes — the two dispatch worlds coexisting in one hierarchy. Its
//    override is reached virtually, including through a base-typed
//    binding, which is the contrast that makes the `end` refusal legible.
const viaBase: { describe(): string } = p;
console.log(p.describe());
console.log(b.describe());
console.log(viaBase.describe());

// 9. The untyped method NOBODY overrides keeps its old story.
console.log(p.tag("t"));
console.log(b.tag("t"));
console.log(p.tag(7));

// 10. The parallel hierarchy whose override widens the arity.
const w = new poolish.Wide("w1");
console.log(w.end(sink, 42));
console.log(w.describe());

// 11. A BASE-TYPED reference that provably holds the SUBCLASS. The static
//     type is the base; the initializer pins the runtime class, so the
//     call resolves to the override at compile time and reaches it.
//     Without that proof the same spelling refuses by name — see
//     poolish-inexact.ts, which is the other half of this pair.
type B = InstanceType<typeof poolish.Base>;
const asBase: B = new poolish.Pooled("p4");
console.log(asBase.end(sink));
console.log("log=" + asBase.log);
console.log("seen=" + seen.join("|"));
