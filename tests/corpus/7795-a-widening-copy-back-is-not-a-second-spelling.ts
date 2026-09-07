// A record's own-key ORDER, with the value crossing a width boundary in
// BOTH directions.
//
// `declaredOrder` is the first interned type's member order, and for an
// interface that EXTENDS another one it is "own members, then inherited" —
// `B` below enumerates `b,a` while the only literal in the program spells
// `a,b`. That is the fiction reconcileKeyOrders exists to re-pick: a shape's
// enumeration order is a choice, the literal is the fact, and once the order
// is re-picked every surface — `Object.keys`, `JSON.stringify`, `for...in`,
// `console.log` — reads Node's own answer.
//
// The re-pick stands down when some construction of the shape reported no
// spelling, because such a construction could carry an order of its own that
// the re-pick would then break. A COMPILER-WRITTEN literal is not one of
// those. The widen-back `n as B` interns a `%rec.width.N` whose body is a
// recordLit at `B` built by walking `B`'s own field list one slot at a time;
// a record enumerates by its shape, so that literal answers `declaredOrder`
// whatever `declaredOrder` becomes. It cannot disagree with a re-pick and no
// order can be taken from it.
//
// Reading it as a missing spelling made ONE widening assignment veto the
// re-pick for the whole program, and the same program without the widen-back
// was right — which is what made it look like a shape-unification defect.
// It is not: shape-unify's obligation 2 (the merged layout restricted to
// each member's own fields reproduces that member's own order) HOLDS here.
// It merges `A` into `B` and faithfully carries `b,a`, because `b,a` was
// already what `B` said before unification ran.

interface A {
    a?: number;
}
interface B extends A {
    b?: number;
}

function keep(x: A): A {
    return x;
}

// Both edges: `keep(...)`'s argument and return narrow B->A, and `n as B`
// widens A->B. With only the first, this printed Node's answer already.
const n: A = keep({ a: 1, b: 2 } as B);
const wide: B = n as B;
console.log(JSON.stringify(n), wide.b);

// `Object.keys(n)` and `for (const k in n)` are DELIBERATELY not asked of
// `n`: they answer "a" where node answers "a,b", on this commit and on the
// one before it alike, and the reason is a different defect one pass over.
// The keys helper is interned while `n`'s use is lowered, against A's
// PRE-MERGE field list; shape unification then widens A into B and rebuilds
// nothing, so the helper still walks one field. reconcileKeyOrders carries
// `enumOrderBakes` for exactly this hazard and unifyWidthShapes has no
// equivalent. It is the SET half, it is not what this file is about, and
// putting it here would pin a wrong answer as expected output. The two
// surfaces are asked below, of a shape no merge touches.

// ── The class-projection form of the same reshaping literal ──────────────
//
// `%obj.width.N` — and `%ctorwitness.N`, its decline route — build THEIR
// record the same way, by walking the target shape's field list, and carried
// the same veto. Here the shape's one source literal spells `first,second`
// while `View` enumerates `second,first`, so the re-pick has work to do and
// the projection must not stand in its way.

interface View {
    readonly second: number;
    readonly first: number;
}

class Holder {
    readonly first: number;
    readonly second: number;
    constructor(first: number, second: number) {
        this.first = first;
        this.second = second;
    }
}

const v: View = { first: 10, second: 20 };
const projected: View = new Holder(30, 40);
console.log(JSON.stringify(v), JSON.stringify(projected));
const seen: string[] = [];
for (const k in v) {
    seen.push(k);
}
// (`Object.keys(projected)` is not asked: a class instance behind a record
// cast has its own fence, and it is not this one.)
console.log(Object.keys(v).join("|"), seen.join("|"));
