// THE COUNTEREXAMPLE THE %Error MATCHER'S MARKER TEST EXISTS TO ANSWER.
//
// The checked-dynamic tree's ERROR ENCODING is an ordinary `SCR_DYN_OBJ`
// carrying `{%error, name, message, code?}` — the shape `caughtToDyn` builds
// and `scr_error_from_dyn` reads back. Every RECORD also wears
// `SCR_DYN_OBJ`. So a record matcher for
//
//     { name: string; message: string }
//
// emits, byte for byte, a test the error encoding SATISFIES:
//
//     if (d->kind != SCR_DYN_OBJ) return false;
//     m = scr_dyn_obj_data_get(d, "message", 7); if (!m || !is_str(m)) return false;
//     m = scr_dyn_obj_data_get(d, "name",    4); if (!m || !is_str(m)) return false;
//     return true;
//
// (measured: compile this file with --keep-c and read `sc_dm_1`.) An Error's
// encoding carries `name` and `message`, both strings. It matches.
//
// TWO THINGS, AND ONLY TWO, KEEP THAT FROM BEING A WRONG ANSWER.
//
//   1. The %Error matcher is not a kind test. It is the reserved `"%error"`
//      marker lookup — EXACTLY the test the %Error dynCheck builder performs,
//      so match and check ask the same question and no arm matched can then
//      fail to build. A plain `{name, message}` object carries no marker and
//      so does NOT take the Error arm; that is the second half below.
//   2. Union arms are interned in canonical typeKey order, and
//      `"object:%Error"` sorts before `"record:rN"` — 'o' < 'r' — so the
//      Error arm is always TRIED FIRST. Order is what resolves the overlap,
//      and it resolves it in the only correct direction.
//
// MEASURED, NOT ASSERTED. Take the C this file emits, swap the two arms of
// the union's dynCheck so the record arm is tried first, and rebuild it with
// `--from-c`: the first case below stops printing `ERR boom` and throws
//
//     Uncaught TypeError: a '{ message: string; name: string }' value is not
//     representable in the target union (a value narrowed or asserted past it
//     still held it)
//
// — the Error came back as the plain record, and the narrow that wanted an
// Error found one that was not. That is a wrong answer against Node, which
// prints `ERR boom`; it is loud rather than silent only because the narrow
// is tag-checked. Without the marker test in (1) it would not even be that:
// a kind-only %Error matcher would take the Error arm for the plain object
// too, and `scr_error_from_dyn` would build an Error out of a record that
// never was one.
//
// WHY THE TYPE PREDICATE. `instanceof` on a union-typed value fences
// ("narrow union-typed values first"), and `String()` of a union with object
// arms fences too, so the arm a value took is observable only through a
// narrow. A user type predicate is the narrow that reaches it, and reading
// `.message` through the `Error` half is the read that a wrongly-tagged
// union cannot serve.
type Alt = { name: string; message: string };
type Shape = { e: Error | Alt };

function isErr(x: Error | Alt): x is Error {
    return x.name === "Error";
}

function describe(s: Shape): string {
    const u: unknown = s;
    const back = u as Shape;
    const e = back.e;
    if (isErr(e)) {
        return `ERR ${e.message}`;
    }
    return `ALT ${e.name}/${e.message}`;
}

// 1. A real Error crossing into `unknown` and back. It must take the %Error
//    arm — the marker is there — and come back readable as an Error.
console.log(describe({ e: new Error("boom") }));

// 2. A plain record with exactly the encoding's two data fields and NO
//    marker. It must take the record arm. A kind-only %Error matcher would
//    take the Error arm here instead, and manufacture an Error from a value
//    that never was one.
console.log(describe({ e: { name: "plain", message: "not an error" } }));

// 3. NOT RUN, AND THE REASON IS ITSELF A MEASUREMENT. The sharpest input is
//    `{ name: "Error", message: "impostor" }` — a plain record wearing an
//    error's two data fields and the error's own name. scriptc gives it the
//    RECORD arm (no marker), which is right; but `isErr` above reads only
//    the DATA, so it answers `true` for it, and the narrow to the Error half
//    is TAG-CHECKED and throws:
//
//        Uncaught TypeError: a '{ message: string; name: string }' value is
//        not representable in the target union (a value narrowed or asserted
//        past it still held it)
//
//    where Node — whose predicates are erased — prints `ERR impostor`.
//    That divergence is not about errors: it is what this compiler does with
//    ANY lying `x is T` predicate over a union, and the alternative is a
//    type-confused read. There is no honest predicate to write instead here
//    — `instanceof` and `in` both fence on a union receiver ("narrow
//    union-typed values first"), measured. So the case stays as prose rather
//    than as a line this file would have to normalise.
//
// 4. And the identity half, which is the reason the %Error arm is worth
//    having at all: an error that crosses and comes back is the SAME object,
//    through the runtime's identity cache, not a rebuilt copy.
const original = new Error("same");
const carried: unknown = { error: original };
const returned = carried as { error: Error };
console.log(`identity ${String(returned.error === original)} ${returned.error.message}`);
