// The two SILENT wrong answers of the record model, made loud. A record is a
// monomorphic struct with no per-instance key list, so its own keys are
// whatever its SHAPE says: `fields` for the set, `declaredOrder` for the
// order. That is Node-exact only while every construction agrees. Two
// constructions do not, and until now neither said so — the program simply
// printed a different object.
//
// Reading a narrowed record's declared fields is untouched and still
// compiles (tests/corpus/4970 is the control). What is refused is
// ENUMERATING one, which is the only place the divergence becomes an answer.

// ---- 1. The ORDER half: TWO literals spelling one shape differently, so
// no order can be the shape's and the enumeration has no right answer to
// give. ONE out-of-order literal is NOT this: a shape's enumeration order is
// a choice, and where the program proves one, reconcileKeyOrders re-picks
// declaredOrder to it and every surface reads Node's own answer. What is
// refused here is an order that is not KNOWABLE.
interface T {
    readonly b: number;
    readonly a: number;
    readonly c: number;
}
const t: T = { c: 3, b: 1, a: 2 };
const t2: T = { b: 4, a: 5, c: 6 };
console.log(JSON.stringify(t), String(t2.a));

// ---- 2. The same half through Object.keys, on a shape two structurally
// equal literals spell differently: one shape, two orders, and the second
// literal loses its own.
const two = { z: 1, y: 2 };
const three = { y: 2, z: 1 };
console.log(Object.keys(two).join(",") + Object.keys(three).join(","));

// ---- 3. The SET half: a width copy into a narrower slot. JS's narrowed
// value is the SAME object and keeps 'extra'; the struct copy ends it.
interface Wide {
    readonly a: string;
    readonly b: string;
    readonly extra: string;
}
interface Narrow {
    readonly a: string;
    readonly b: string;
}
const wide: Wide = { a: "A", b: "B", extra: "X" };
const narrow: Narrow = wide;
console.log(Object.keys(narrow).join("|"));

// ---- 4. The SET half in spread clothing, reported at a third surface.
interface Small {
    readonly a: string;
}
const small: Small = { ...wide };
let seen = "";
for (const k in small) {
    seen = seen + k + ";";
}
console.log(seen);
