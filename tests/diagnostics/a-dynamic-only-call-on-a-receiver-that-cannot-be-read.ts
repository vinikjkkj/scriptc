// TWO shapes of the same call, and only one of them owes a diagnostic. This
// file exists because the difference looked like a MISSED FENCE and is not one.
//
// `string.prototype.replace` is dynamic-only in the shipped surface manifest
// (SC2012), so a static build must refuse it. It does -- on the second call
// below, and on every real receiver tried: a parameter, a local, a literal.
//
// It does NOT refuse on the first call, and that is correct rather than a hole.
// `ambient` is a `declare const`: an ambient binding with no runtime value, so
// READING it is an undefined-global read, which throws a ReferenceError exactly
// as Node does. The compiler lowers that read to `scr_undef_global_read`
// followed by a pending-exception check and RETURN, and emits no member call at
// all. The `.replace()` is unreachable, so no refusal is owed and none fires.
//
// The rule is about reachability, not about the method: the same ambient
// receiver with the fully SUPPORTED `toUpperCase()` also emits no call and
// produces the same ReferenceError. And the boundary cannot be escaped -- a
// program cannot define the global first, because `globalThis` itself has no
// lowering (SC2020), so there is no compilable way to make an ambient binding
// exist at run time.
//
// The snapshot is the assertion: exactly one SC2012, on the REAL receiver.
declare const ambient: string

// Unreachable: the receiver read throws before the call. No diagnostic owed.
const fromAmbient = ambient.replace('@', ':0@')
console.log('ambient=' + fromAmbient)

// Reached, and dynamic-only: this is the site that must refuse.
function fromParameter(jid: string): string {
    return jid.replace('@', ':0@')
}
console.log('param=' + fromParameter('u@v'))
