// A builtin held as a VALUE, and the one property of it that a compiler
// can get wrong without saying anything: IDENTITY.
//
// `isNaN` and its friends lower to a zero-capture closure over a
// synthesized module function, and the backends intern exactly that shape
// into one immortal static closure. So every mention of the name is the
// SAME pointer and `a === isNaN` is `true`, the way it is in Node. The
// moment anything mints a fresh closure on the way into a slot -- an
// arity adapter, a per-read allocation -- that line flips to `false` and
// nothing else about the program changes. `const a = parseInt; a ===
// parseInt` printed exactly that during development.
//
// So this fixture walks every route a builtin value can take to a `===`:
// two aliases, a record field, an array element, an argument, a return, a
// capture that outlives the frame that made it, and a `let` reassigned
// after the value was copied out of it. It also calls through each route,
// because a value that compares right and calls wrong is the same class
// of defect one step further along.

function takes(g: (n: number) => boolean): boolean {
    return g === isNaN
}

function gives(): (n: number) => boolean {
    return isNaN
}

function makeCapture(): () => boolean {
    const inner = isNaN
    return () => inner === isNaN
}

function makeCaller(): (n: number) => boolean {
    const inner = isFinite
    return (n: number) => inner(n)
}

function mine(n: number): boolean {
    return n > 100
}

const a1 = isNaN
const a2 = isNaN
const rec: { f: (n: number) => boolean } = { f: isNaN }
const arr: Array<(n: number) => boolean> = [isNaN, isFinite]

console.log(isNaN === isNaN, a1 === isNaN, a1 === a2)
console.log(rec.f === isNaN, arr[0] === isNaN, arr[1] === isFinite)
console.log(takes(isNaN), takes(a1), takes(isFinite))
console.log(gives() === isNaN, gives() === gives())
console.log(makeCapture()())
console.log(makeCaller()(1), makeCaller()(1 / 0))

let slot: (n: number) => boolean = isNaN
const copied = slot
console.log(slot === isNaN, copied === isNaN)
slot = mine
console.log(slot === isNaN, copied === isNaN)
console.log(slot(0 / 0), slot(200), copied(0 / 0), copied(200))

// The `??` default -- zapo's own shape at wa-version-fetcher.ts:97, in the
// one spelling that does not need `typeof fetch` to map.
const absent: { p?: (n: number) => boolean } = {}
const present: { p?: (n: number) => boolean } = { p: mine }
const chosenDefault = absent.p ?? isNaN
const chosenGiven = present.p ?? isNaN
console.log(chosenDefault === isNaN, chosenGiven === isNaN)
console.log(chosenDefault(0 / 0), chosenGiven(200))

console.log(typeof isNaN, typeof a1, typeof parseFloat)
