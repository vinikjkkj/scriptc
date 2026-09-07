// `require` inside an ES MODULE, where Node defines no such binding.
//
// Node defines `require` as a MODULE-SCOPE binding of a CommonJS module
// and NOWHERE else — not on globalThis, and not in an ES module. So in
// this file the name is unbound: `typeof require` is "undefined" and every
// other read of it is `ReferenceError: require is not defined`. It is not
// a resolution failure — no specifier is ever looked at, which is why the
// specifier below names a package that does not exist and the answer is
// the same as it would be for one that does.
//
// zapo-js 1.8.2 probes an optional native crypto accelerator this way
// (crypto/nativeBackend.ts:47/48/97) and CLASSIFIES the failure: its
// isBackendAbsence() checks `error instanceof ReferenceError` with the
// message "require is not defined" FIRST, precisely because the ESM build
// of the library is the one that lands here. A refusal at compile time
// could not tell it that; this can.
//
// The positions below are one fact seen several ways — the reference
// throws before the call's arguments, before the member, and before the
// binding — so nothing distinguishes them but where the throw appears.
//
// Every read here is CAUGHT, which is the whole observable population.
// Node's loader appends " in ES module scope, you can use import instead"
// to a `require is not defined` error that escapes module evaluation
// UNCAUGHT, and that suffix is a property of where the error ends up
// rather than of where it was thrown: the same top-level site prints the
// plain message when a try/catch reads it and the decorated one when
// nothing does. A compiled program prints the undecorated message in both
// places, so an uncaught top-level require is the one row this file
// cannot hold — it is a crash that names the same error at the same line.

function why(e: unknown): string {
    return e instanceof Error ? e.name + ": " + e.message : "not an Error: " + String(e);
}

console.log("typeof:", typeof require);

// A call. The callee reference is evaluated FIRST, so the argument never
// runs: `spec()` printing nothing is part of the answer.
function spec(): string {
    console.log("the specifier was evaluated");
    return "@no/such-package";
}
try {
    console.log("called:", String(require(spec())));
} catch (e) {
    console.log("called:", why(e));
}

// A member. `require.resolve` would answer a path in CommonJS; here the
// receiver throws before the member is reached.
try {
    console.log("resolve:", String(require.resolve("@no/such-package")));
} catch (e) {
    console.log("resolve:", why(e));
}

// The bare binding as a value.
try {
    const r = require;
    console.log("value:", typeof r);
} catch (e) {
    console.log("value:", why(e));
}

// STATEMENT position — a bare side-effect require. It never reaches the
// expression path, so it is spelled separately in the lowering and pinned
// separately here: `require(x);` refusing where `void require(x);` threw
// would be the same fact answered two ways.
try {
    require("@no/such-package");
    console.log("statement: no throw");
} catch (e) {
    console.log("statement:", why(e));
}

// A LOCAL binding of the same name is an ordinary variable and shadows
// nothing that throws.
{
    const require = (id: string): string => "local(" + id + ")";
    console.log("shadowed:", require("x"));
}

export {};
