// A record that crosses into a checked-dynamic slot lists the keys the VALUE
// holds, not the keys its SHAPE declares.
//
// A record struct has one slot per declared field plus a per-instance union
// tag saying which arm the slot holds, so "this optional field is not there"
// is a run-time fact the value really carries. The frontend's interned keys
// helper reads that tag (recordKeysArrayCall guards each undefined-armed
// field), which is why `Object.keys` of the record DIRECTLY was always right.
// The record->dyn converter did not: it set every declared field
// unconditionally, so the same value read through an `object`-typed slot
// answered the shape's field list. Two enumerations of one value, disagreeing
// with each other, with the direct one correct:
//
//     const p: Msg = { a: 1 };
//     Object.keys(p)          // "a"      (right)
//     keysOf(p)               // "a,b,c"  (wrong, before this fixture)
//
// and Object.values/Object.entries did not merely answer wrongly — they
// walked into the boundary validator on the undefined they then had to
// convert and ABORTED, where Node prints a value.
//
// Every surface below is a read of the SAME widened value. They must agree
// with Node and with each other.
//
// NOT asserted, deliberately: a field written as an explicit `undefined`
// (`{ a: 1, b: undefined }`). Node lists "b"; a record has no per-instance
// "was written" bit, so scriptc answers "absent" for it. That is the
// documented divergence tests/corpus/3713 names, and it is answered the SAME
// way now on both surfaces — before this fixture the direct read said absent
// and the widened read said present, for one value.

interface Msg {
    a?: number;
    b?: string;
    c?: boolean;
}

function keysOf(o: object): string {
    return Object.keys(o).join(",");
}
function valuesOf(o: object): string {
    // JSON.stringify of the values ARRAY, not String() per element: a
    // heterogeneous dyn object's Object.values is a mixed array the
    // element-typed extraction refuses (that fence is main's and is not
    // what this fixture is about) — the JSON text still shows exactly which
    // values came out, in order.
    return JSON.stringify(Object.values(o));
}
function entriesOf(o: object): string {
    return JSON.stringify(Object.entries(o));
}
function ownNamesOf(o: object): string {
    return Object.getOwnPropertyNames(o).join(",");
}
function forInOf(o: object): string {
    const out: string[] = [];
    for (const k in o) out.push(k);
    return out.join(",");
}
function hasOwnOf(o: object, k: string): string {
    return String(Object.hasOwn(o, k));
}
function inOf(o: object, k: string): string {
    return String(k in o);
}
function assignOf(o: object): string {
    return JSON.stringify(Object.assign({}, o));
}
function jsonOf(o: object): string {
    return JSON.stringify(o);
}

function report(label: string, o: object): void {
    console.log(label + " keys      " + keysOf(o));
    console.log(label + " values    " + valuesOf(o));
    console.log(label + " entries   " + entriesOf(o));
    console.log(label + " ownNames  " + ownNamesOf(o));
    console.log(label + " for-in    " + forInOf(o));
    console.log(label + " hasOwn b  " + hasOwnOf(o, "b"));
    console.log(label + " in c      " + inOf(o, "c"));
    console.log(label + " assign    " + assignOf(o));
    console.log(label + " json      " + jsonOf(o));
}

// ---- the three occupancies of one shape --------------------------------
const one: Msg = { a: 1 };
const none: Msg = {};
const all: Msg = { a: 1, b: "s", c: true };

report("one ", one);
report("none", none);
report("all ", all);

// The DIRECT read of the same values, which was always right: the two
// enumerations of one value must agree.
console.log("direct one  " + Object.keys(one).join(","));
console.log("direct none " + Object.keys(none).join(","));
console.log("direct all  " + Object.keys(all).join(","));

// ---- the boundaries a record crosses into a dyn slot -------------------
// One interned converter per shape answers all of them, so each is a
// separate chance to find a site the converter does not cover.

// a declared `object` binding
const asVar: object = one;
console.log("var         " + keysOf(asVar));

// a declared return type
function widen(): object {
    return one;
}
console.log("return      " + keysOf(widen()));

// an array element
const inArray: object[] = [one, none, all];
const arrParts: string[] = [];
for (const x of inArray) arrParts.push(keysOf(x));
console.log("array       " + arrParts.join(" / "));

// a record FIELD
const inField: { m: object } = { m: one };
console.log("field       " + keysOf(inField.m));

// a record field two levels down
const inField2: { m: { n: object } } = { m: { n: one } };
console.log("field2      " + keysOf(inField2.m.n));

// an `unknown` parameter, cast back at the read
function viaUnknown(u: unknown): string {
    return Object.keys(u as object).join(",");
}
console.log("unknown     " + viaUnknown(one));

// a whole ARRAY of records widened at once
const manyIn: Msg[] = [one, none, all];
function widenAll(xs: object[]): string {
    const parts: string[] = [];
    for (const x of xs) parts.push(keysOf(x));
    return parts.join(" / ");
}
console.log("array-param " + widenAll(manyIn));

// ---- and back ----------------------------------------------------------
// A record materialised OUT of the widened value sees the same key set: the
// extraction completes the absent optionals to their undefined arm, which is
// what an absent key means.
function through(o: object): object {
    return o;
}
const back = through(one) as Msg;
console.log("back a      " + String(back.a));
console.log("back b      " + String(back.b));
console.log("back keys   " + Object.keys(back).join(","));
console.log("back json   " + JSON.stringify(back));

// ---- a field GROWN after construction ----------------------------------
// The tag is per instance, so a field assigned later becomes present, and
// the widened read has to see that too.
const grown: Msg = { a: 1 };
console.log("grown pre   " + keysOf(grown));
grown.c = false;
console.log("grown post  " + keysOf(grown));

// ---- a nested record whose OWN optional is absent ----------------------
interface Wrap {
    inner?: Msg;
    tag: string;
}
// Written in DECLARED order on purpose. A literal spelled in a different
// order than its interface declares enumerates in the DECLARED order here
// and in the written order in Node — the recorded key-ORDER debt, which is
// a different question from which keys are listed and is not this
// fixture's to re-litigate.
const wrapped: Wrap = { inner: { b: "x" }, tag: "t" };
console.log("wrap keys   " + keysOf(wrapped));
console.log("wrap json   " + jsonOf(wrapped));
const wrapEmpty: Wrap = { tag: "t" };
console.log("wrapE keys  " + keysOf(wrapEmpty));
console.log("wrapE json  " + jsonOf(wrapEmpty));

// ---- a union-typed optional -------------------------------------------
interface Mixed {
    v?: number | string;
    w?: number[];
    z?: { k: number };
}
const mixedOne: Mixed = { v: 1 };
const mixedNone: Mixed = {};
console.log("mixed1 keys " + keysOf(mixedOne));
console.log("mixed1 json " + jsonOf(mixedOne));
console.log("mixed0 keys " + keysOf(mixedNone));
console.log("mixed0 json " + jsonOf(mixedNone));
const mixedAll: Mixed = { v: "s", w: [1, 2], z: { k: 3 } };
console.log("mixedA keys " + keysOf(mixedAll));
console.log("mixedA json " + jsonOf(mixedAll));

// ---- a required field is never gated ------------------------------------
// The presence gate applies to undefined-armed fields only; a required one
// has no absent state and must keep its unconditional store.
interface Req {
    r: number;
    o?: number;
}
console.log("req  keys   " + keysOf({ r: 1 } as Req));
console.log("req2 keys   " + keysOf({ r: 1, o: 2 } as Req));
