// `ReferenceError` as a REAL runtime class, and the reason it had to be
// one rather than a name comparison.
//
// The runtime already THREW this error: `scr_undef_global_read` is the
// erased-`declare const` stance and the ES-module `require` rule (corpus
// 7789), whose whole subject is "Node defines no such binding here". But
// it minted an SCR_ERR_ERROR wearing the STRING "ReferenceError", so
// `e instanceof ReferenceError` had no lowering at all -- and zapo-js
// 1.8.2's `isBackendAbsence` opens with exactly that test, on the path
// that decides whether the native-crypto probe falls back silently
// (`crypto/nativeBackend.ts:70`).
//
// THE NAME COMPARE WOULD HAVE BEEN WRONG, and the sixth line below is the
// proof: `e.name = "ReferenceError"` on a plain Error compiles here, and
// Node answers `e instanceof ReferenceError` FALSE for it. A vtable with
// its own preorder interval is the only test that agrees, which is why
// the class is real -- `%ReferenceError`, kind 5, base `%Error`.
//
// What this pins against Node: the classification `isBackendAbsence`
// performs; construction with and without `new`; the interval against
// siblings and against the root; the ASSIGNED-name trap; the narrow out
// of an `unknown` (the identity cache's interval test, not the marker
// alone -- which is what lets `v instanceof TypeError` read `v.message`
// afterwards, a shape that used to be an internal compiler error); a
// catch binding; `extends ReferenceError`; and toString.

// The zapo shape, verbatim in structure.
function isBackendAbsence(error: unknown): boolean {
    if (error instanceof ReferenceError) {
        return error.message.includes("require is not defined");
    }
    return false;
}

function probe(): unknown {
    try {
        const mod = require("@does-not-exist/native") as unknown;
        return mod;
    } catch (e) {
        return e;
    }
}

const caught = probe();
console.log("absence?", isBackendAbsence(caught));
console.log("name", caught instanceof Error ? caught.name : "?");
console.log("is Error", caught instanceof Error, "is TypeError", caught instanceof TypeError);

// Construction, both spellings the language gives.
const r = new ReferenceError("hand built");
console.log("ctor", r.name, r.message, r instanceof ReferenceError, r instanceof Error, r instanceof RangeError);
const r2 = ReferenceError("no new");
console.log("callform", r2.name, r2.message, r2 instanceof ReferenceError);
console.log("empty", new ReferenceError().message === "");

// The trap: an ASSIGNED name is not a class.
const renamed = new Error("renamed");
renamed.name = "ReferenceError";
console.log("renamed", renamed.name, renamed instanceof ReferenceError, renamed instanceof Error);

// Narrowing out of `unknown`: the identity cache's interval test. Reading
// a field AFTER the narrow is the half that used to be unreachable.
function classify(v: unknown): string {
    if (v instanceof ReferenceError) return "ref:" + v.message;
    if (v instanceof TypeError) return "type:" + v.message;
    if (v instanceof RangeError) return "range:" + v.message;
    if (v instanceof Error) return "err:" + v.message;
    return "other";
}
console.log(classify(new ReferenceError("a")));
console.log(classify(new TypeError("b")));
console.log(classify(new RangeError("c")));
console.log(classify(new Error("d")));
console.log(classify(renamed));
console.log(classify(42));
console.log(classify("s"));

// The NAME read back through the checked-dynamic tree, which is a
// different question from `instanceof` and has its own table. The encoding
// HIDES a name equal to the kind's canonical one -- in Node that is
// `TypeError.prototype.name`, inherited and invisible to Object.keys -- so
// something has to carry it, and that is the per-kind prototype. A kind
// with no prototype of its own inherits %Error.prototype%'s name, so
// hiding "ReferenceError" against a missing one loses it and this reads
// "Error". Corpus 2861 caught exactly that when ReferenceError became a
// kind whose index sits past the contiguous range the table used.
function nameOf(v: unknown): string {
    return v instanceof Error ? v.name : "?";
}
console.log("names", nameOf(new Error("a")), nameOf(new TypeError("b")), nameOf(new RangeError("c")));
console.log("names", nameOf(new SyntaxError("d")), nameOf(new ReferenceError("e")));
// An ASSIGNED name takes the other branch of that decision — it is an own
// property, not the kind's — and survives regardless.
const tagged = new ReferenceError("f");
tagged.name = "Tagged";
console.log("assigned", nameOf(tagged), tagged.message, String(tagged));

// A catch binding tests against the class's interval directly.
try {
    throw new ReferenceError("thrown");
} catch (e) {
    console.log("caught", e instanceof ReferenceError, e instanceof Error, e instanceof SyntaxError);
    console.log("caught msg", e instanceof Error ? e.message : "?");
}

// A user subclass: its own interval nests inside ReferenceError's, so it
// answers true for both and for Error.
class MissingBinding extends ReferenceError {
    readonly binding: string;
    constructor(binding: string) {
        super(binding + " is not defined");
        this.name = "MissingBinding";
        this.binding = binding;
    }
}
const m = new MissingBinding("require");
console.log("sub", m.name, m.message, m.binding);
console.log("sub is", m instanceof MissingBinding, m instanceof ReferenceError, m instanceof Error, m instanceof TypeError);
console.log("toString", String(r), String(m));

// NOT asserted here, and it is not this change's to assert: a USER
// subclass of any error crossing into `unknown` boxes as an instance
// (canBoxClassIntoDyn) rather than as the error encoding, so
// `classify(m)` answers "other" where Node answers "ref:...". Measured
// identical for `class MyErr extends Error` on the tree before this
// change, so the row belongs to the dyn box's class rule and not to the
// error hierarchy.

// A throw that ESCAPES a function and is classified by the caller, which
// is the whole shape the native-backend probe uses.
function loadOrNull(): string | null {
    try {
        return require("still-not-there") as string;
    } catch (e) {
        return isBackendAbsence(e) ? null : "broken";
    }
}
console.log("load", loadOrNull());

export {};
