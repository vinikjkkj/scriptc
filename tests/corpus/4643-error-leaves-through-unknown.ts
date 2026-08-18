// The %Error LEAF's stress shapes, beyond the one row that needed it.
//
// `canDynCheckTo` has always admitted `%Error` STANDING ALONE — the
// checked-dynamic tree's error encoding, extracted through the runtime's
// identity cache — while its own NESTED walker answered `canBoxClassIntoDyn`,
// which is `false` for the error hierarchy. So one IR type was checkable as
// the whole target and uncheckable as a record field, sixty lines apart in
// the same function: the rows-3-and-4 shape exactly.
//
// The asymmetry was one-directional in the worst way. `canConvertToDyn`'s
// record rule recurses with the FULL predicate, so an `%Error` field has
// always converted IN. Letting a value in without letting it back out is the
// method-bundle lesson, and here it stranded every record carrying an Error.
//
// Each line below ends in something a COPY would get wrong, or in a read
// only the right representation can serve.
const e = new Error("boom");

// 1. The bare leaf, in a record field: the shape zapo's `debug_client_error`
//    has. `=== e` is the identity cache — the object that went in is the one
//    that comes back, not a rebuild.
const a: unknown = { error: e };
const ra = a as { error: Error };
console.log("field", ra.error.message, ra.error === e);

// 2. An OPTIONAL error field. `Error | undefined` is a UNION, so this is the
//    path that needs the %Error dynMATCHER and not only the checker: the
//    union builder asks each arm's matcher before it builds one.
const b: unknown = { error: e };
const rb = b as { error?: Error };
console.log("opt-present", rb.error === undefined ? "none" : rb.error.message);

const c: unknown = {};
const rc = c as { error?: Error };
console.log("opt-absent", rc.error === undefined ? "none" : rc.error.message);

// 3. An ARRAY of errors — the same walker, one container over.
const d: unknown = { errors: [e, new Error("two")] };
const rd = d as { errors: Error[] };
console.log("array", rd.errors.length, rd.errors[0]!.message, rd.errors[1]!.message, rd.errors[0] === e);

// 4. A record INSIDE a record. Nothing new in the rule; the point is that the
//    walker recurses through the container it already recursed through.
const f: unknown = { inner: { error: e }, n: 3 };
const rf = f as { inner: { error: Error }; n: number };
console.log("nested", rf.inner.error.message, rf.n);

// 5. The loud half. A field that is not an error does not become one: the
//    encoding's reserved marker is absent, so the extraction refuses. Node
//    refuses at the first read the wrong value cannot serve; the sites and
//    therefore the words differ, and what is pinned is that neither quietly
//    succeeds.
try {
    const g: unknown = { error: 42 };
    const rg = g as { error: Error };
    console.log("WRONG number-into-error-slot:", rg.error.message.length);
} catch {
    console.log("number-slot: threw");
}

// A plain record wearing an error's two data fields is the sharpest case:
// it satisfies a `{name, message}` RECORD matcher exactly (4642), and it is
// the reserved marker — not the contents — that says it is not an error.
// `.stack` is the read that makes NODE refuse too: the impostor has none,
// so the `!` is a lie there and the length read throws, while scriptc has
// already refused at the boundary.
try {
    const h: unknown = { error: { name: "Error", message: "impostor" } };
    const rh = h as { error: Error };
    console.log("WRONG record-into-error-slot:", rh.error.stack!.length);
} catch {
    console.log("record-slot: threw");
}
