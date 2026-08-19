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

// ---- 1. The ORDER half: a literal spelled in an order the shape does not
// carry. `declaredOrder` is the first-interned type's member order, so this
// object enumerates b,a,c where Node enumerates c,b,a.
interface T {
    readonly b: number;
    readonly a: number;
    readonly c: number;
}
const t: T = { c: 3, b: 1, a: 2 };
console.log(JSON.stringify(t));

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
