// The Error constructors CALLED AS FUNCTIONS — `Error("x")`, not
// `new Error("x")`. ECMA-262 20.5.1.1 makes the two spellings one thing:
// "when Error is called as a function rather than as a constructor, it
// creates and initializes a new Error object. Thus the function call
// Error(...) is equivalent to the object creation expression
// new Error(...) with the same arguments" — and 20.5.6.1.1 says the same
// of every NativeError (TypeError/RangeError/SyntaxError).
//
// `throw Error("...")` is the whole reason the form exists, and it is what
// minifiers and hand-written JS libraries actually write.
//
// What this pins against Node:
//
//  - the value is a real error, not a stand-in: `.message`, `.name`,
//    `.toString()`, `instanceof Error`, and catching it all answer exactly
//    what the `new` spelling answers. The two spellings are printed side by
//    side so a divergence between them shows up in this one file.
//  - each NativeError keeps its OWN name and its own identity, and each is
//    still an `instanceof Error` — the subclass link survives the call form.
//  - the message defaults: `Error()` and `Error(undefined)` both leave
//    `message` as the empty string (the spec only installs the property
//    when the argument is not undefined), so `.toString()` drops the
//    ": " separator and prints the bare name.
//  - the call is an ORDINARY expression, so it composes: assigned to a
//    binding, returned from a function, thrown, and rethrown from a catch.
//  - PROVENANCE: a user binding that shadows the global `Error` is a
//    different symbol and must keep taking the user's function. The
//    shadowed call here answers "user:..." — if the lowering matched on the
//    NAME instead of the symbol it would answer an Error object and this
//    line would change.

function describe(e: Error): string {
    return `${e.name}|${e.message}|${e.toString()}|${e instanceof Error}`
}

// ── the equivalence, spelling against spelling ──────────────────────────
console.log("call ", describe(Error("boom")))
console.log("new  ", describe(new Error("boom")))

console.log("call ", describe(TypeError("bad type")))
console.log("new  ", describe(new TypeError("bad type")))

console.log("call ", describe(RangeError("out of range")))
console.log("new  ", describe(new RangeError("out of range")))

console.log("call ", describe(SyntaxError("unexpected token")))
console.log("new  ", describe(new SyntaxError("unexpected token")))

// ── the subclass link survives the call form ────────────────────────────
console.log("te is Error   ", TypeError("t") instanceof Error)
console.log("re is Error   ", RangeError("r") instanceof Error)
console.log("se is Error   ", SyntaxError("s") instanceof Error)
console.log("e  is TypeErr ", Error("e") instanceof TypeError)
console.log("te is RangeErr", TypeError("t") instanceof RangeError)

// ── the message defaults ────────────────────────────────────────────────
const empty = Error()
console.log("empty        ", `${empty.name}|${empty.message}|${empty.toString()}|${empty.message.length}`)
const undef = Error(undefined)
console.log("undefined arg", `${undef.name}|${undef.message}|${undef.toString()}|${undef.message.length}`)
const emptyType = TypeError()
console.log("empty type   ", `${emptyType.name}|${emptyType.message}|${emptyType.toString()}`)

// ── it is an ordinary expression ────────────────────────────────────────
function makeError(n: number): Error {
    if (n > 2) {
        return RangeError(`n too large: ${n}`)
    }
    return Error(`n is ${n}`)
}

for (let i = 1; i <= 3; i = i + 1) {
    console.log("made", describe(makeError(i)))
}

// `throw Error(...)` — the form the bundles are full of.
function depth(n: number): number {
    if (n > 3) {
        throw Error("max depth exceeded")
    }
    return n * 2
}

for (let i = 2; i <= 5; i = i + 1) {
    try {
        console.log("depth", i, depth(i))
    } catch (e) {
        console.log("depth", i, "threw", (e as Error).message, (e as Error).name)
    }
}

// Rethrow from a catch, with a different constructor, still call-form.
try {
    try {
        throw TypeError("inner")
    } catch (inner) {
        throw RangeError(`wrapped: ${(inner as Error).message}`)
    }
} catch (outer) {
    console.log("rethrown", describe(outer as Error))
}

// The error flows through a union arm and a stored array like any value.
const errs: Error[] = [Error("a"), TypeError("b"), SyntaxError("c")]
const names: string[] = []
for (const e of errs) {
    names.push(`${e.name}:${e.message}`)
}
console.log("stored", names.join(","))

// ── provenance: a SHADOWING user binding is not the global ──────────────
function shadowed(): string {
    const Error = (m: string): string => `user:${m}`
    return Error("not the builtin")
}
console.log("shadow", shadowed())
