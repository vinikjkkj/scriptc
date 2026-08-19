// `Object.assign` over sources whose own enumerable keys the copy can
// actually see — the positive control for the class-instance fence.
//
// A fresh object-literal target routes the whole call through the dyn
// n-ary walk, which copies each source's own enumerable keys left to
// right. A CLASS INSTANCE widens into a box that carries the class's
// identity and no field table, so that walk used to find nothing to copy
// and — with a target already holding a same-typed value for every name —
// silently answered the DEFAULTS where Node answers the source's values.
// That spelling is a compile-time refusal now
// (tests/diagnostics/object-assign-from-a-class-instance.ts).
//
// This program pins the half that must keep working, byte for byte against
// Node: record sources, several of them, in order, with later-wins
// overwrites, optional fields, nested records, arrays, an aliased record
// target, and the empty-target identity — plus the two shapes whose
// answers are easy to get subtly wrong (a source key absent from the
// target, and an explicit `undefined`).

interface Opts {
    host: string
    port: number
    tls: boolean
}

const defaults: Opts = { host: "localhost", port: 80, tls: false }

// One source, every key overwritten.
console.log(JSON.stringify(Object.assign({ host: "", port: 0, tls: true }, defaults)))

// Later wins, across three sources.
console.log(
    JSON.stringify(
        Object.assign({ host: "", port: 0, tls: false }, defaults, { port: 443 }, { tls: true }),
    ),
)

// An EMPTY target: the result is exactly the source's own keys.
console.log(JSON.stringify(Object.assign({}, defaults)))

// A source carrying a key the target does not declare — JS keeps it.
console.log(JSON.stringify(Object.assign({}, defaults, { extra: "kept" })))

// An explicit `undefined` in the source: JS copies the KEY, and
// JSON.stringify then drops it from the text — so what this line pins is
// that the copy does not turn `b` into something stringify KEEPS.
console.log(JSON.stringify(Object.assign({}, { a: 1, b: undefined })))

// A nested record and an array ride through the copy with their VALUES
// intact. What is deliberately NOT pinned here is aliasing: JS's assign is
// shallow, so `shallow.inner` IS `nested.inner` and a write through one is
// visible through the other, while values cross scriptc's dynamic boundary
// by copy (Limitations: "values cross by copy, never by reference") and the
// write is not. Measured in this session and left to the documented
// divergence rather than smuggled into a byte-exact fixture: after
// `shallow.inner.n = 2`, Node reads nested.inner.n as 2 and this compiler
// reads 1.
const nested = { inner: { n: 1 }, list: [1, 2, 3] }
const shallow = Object.assign({}, nested)
console.log(JSON.stringify(shallow), JSON.stringify(shallow.list.length))

// An ALIASED record target: assign returns the target itself, mutated in
// place, and the alias observes it.
const target: Opts = { host: "a", port: 1, tls: false }
const alias = target
const returned = Object.assign(target, { port: 8080 })
console.log(returned.port, alias.port, returned === target, returned === alias)

// The return value is the target, not a copy — for the fresh-literal form
// the identity is unobservable, so what is pinned is the VALUE.
const fresh = Object.assign({ n: 0 }, { n: 7 })
console.log(fresh.n)

// Zero sources: the target comes back unchanged.
console.log(JSON.stringify(Object.assign({ only: 1 })))
