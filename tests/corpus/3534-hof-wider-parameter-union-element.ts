// The wider-parameter rule, one step over: the ELEMENT is itself a union and
// the callback's parameter is a union with strictly more arms.
// `(Env | null)[]` handed to `(e: Env | null | undefined) => R` is zapo's
// `client/newsletter/discovery.ts:111` and `parse.ts:226`, the two spellings
// the plain arm wrap did not reach — there the element does not box into ONE
// destination arm, it re-wraps arm BY arm.
//
// Admitted on exactly the terms unionRetagHelper states for itself: a plain
// re-wrap is identity-preserving, a width-LIFTED arm is a copy, and an arm
// with no destination throws an UNCODED TypeError. So every arm of the
// element must have an IDENTICAL arm in the parameter — total, no lift, no
// strand. The identity assertion below is what makes that distinction
// observable: under a lift it would print false.

type Env = { id: string; n: number };

function label(e: Env | null | undefined): string {
    if (e === null) return "<null>";
    if (e === undefined) return "<undef>";
    return e.id;
}

const shared: Env = { id: "a", n: 1 };
const rows: (Env | null)[] = [shared, null, { id: "b", n: 2 }];

// Each inline callback carries an explicit `: boolean` return annotation.
// Without one tsc INFERS a type predicate (`e is Env`) for a body that
// narrows its own parameter, and a predicate-typed function value has its
// own separate fence — nothing to do with this rule, and it would hide it.
console.log(rows.map(label).join(","));
console.log(rows.filter((e: Env | null | undefined): boolean => e !== null && e !== undefined).length);
console.log(String(rows.find((e: Env | null | undefined): boolean => e !== null && e !== undefined && e.id === "b")?.id));
console.log(rows.some((e: Env | null | undefined): boolean => e === null));
console.log(rows.every((e: Env | null | undefined): boolean => e !== undefined));
console.log(rows.reduce((acc: string, e: Env | null | undefined) => acc + label(e), "|"));

// The element reaching the callback is the array's OWN element: the re-wrap
// carries the payload pointer, it does not rebuild the record.
let sawShared = false;
rows.forEach((e: Env | null | undefined) => {
    if (e === shared) sawShared = true;
});
console.log("identity", sawShared);

rows.forEach((e: Env | null | undefined) => {
    if (e !== null && e !== undefined) e.n = e.n * 10;
});
console.log(rows.map((e) => (e === null ? -1 : e.n)).join(","));
console.log(shared.n);

// A UNIT-only widening on the other side: the element union already carries
// undefined and the parameter adds null.
const withUndef: (Env | undefined)[] = [shared, undefined];
console.log(withUndef.map(label).join(","));

// And the exact-match spelling, unchanged by any of this.
const exact: (Env | null | undefined)[] = [shared, null, undefined];
console.log(exact.map(label).join(","));
