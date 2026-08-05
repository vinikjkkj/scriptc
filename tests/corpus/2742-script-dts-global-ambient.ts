// The bundler-define ambients of corpus 1581, moved into a SCRIPT
// declaration file — the spelling that decides which side of the
// declaration-module fence a `.d.ts` binding falls on.
//
// Every declaration inside a `.d.ts` carries the Ambient modifier, so a
// modifier check alone cannot tell these two apart:
//
//   - a SCRIPT `.d.ts` declares globals. Nothing defines them, there is no
//     implementation file it could be the declaration half OF, and Node
//     erases it — so the read throwing "<name> is not defined" is exact,
//     and that is what this program pins against Node.
//   - a MODULE `.d.ts` declares the surface of a real file Node loads.
//     Answering "not defined" there is a wrong value; it fences instead
//     (tests/diagnostics/dts-module-without-twin).
//
// Nothing here may change: this is the control that keeps the fence from
// widening onto the erasure stance.
//
// Not covered here, and pre-existing: an ambient `declare function` in a
// `.d.ts` of EITHER kind has no lowering at all —
// ambientUndefinedFnSymbolOf declines on isDeclarationFile, so the call
// reaches the unresolved-binding fence instead of Node's ReferenceError.
// The same read spelled in a program `.ts` compiles (corpus 1581).
/// <reference path="./2742-script-dts-global-ambient/globals.d.ts" />

// A plain read, at FUNCTION scope (a module-scope holder lowers through a
// different branch).
function readVersion(): string {
    try {
        return `v${__VERSION__}`
    } catch (err) {
        return err instanceof Error ? `${err.name}|${err.message}` : '?'
    }
}

// A read in CONDITION position.
function readFlag(): string {
    try {
        return __BUILD_FLAG__ ? 'on' : 'off'
    } catch (err) {
        return err instanceof Error ? err.message : '?'
    }
}

// The chain form: the ROOT read throws before any member access, and `?.`
// cannot guard a ReferenceError on the root itself.
function chainRead(): string {
    try {
        return `${__VERSION__.length}`
    } catch (err) {
        return err instanceof Error ? err.message : '?'
    }
}

// The root evaluates before the ARGUMENT, so the argument never runs.
function chainCall(): string {
    let touched = 'no'
    const arg = (): string => {
        touched = 'yes'
        return 'k'
    }
    try {
        return `${__VERSION__.padStart(4, arg())} ${touched}`
    } catch (err) {
        return `${err instanceof Error ? err.message : '?'} ${touched}`
    }
}

console.log(readVersion())
console.log(readFlag())
console.log(chainRead())
console.log(chainCall())
