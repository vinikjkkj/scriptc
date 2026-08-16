// A `var` inside a GENERIC function instantiated more than once.
//
// The same root cause as 4181 and a DIFFERENT symptom, on a path that
// needs no flags at all: `hoistVarBinding`'s memo was keyed by the
// checker's `ts.Symbol` on the LOWERER, and `lowerGenericInstance` lowers
// one body once per instantiation with a FRESH frame each time. Instance
// 1 got instance 0's IrLocal back -- a local that is not in instance 1's
// frame and has no `varDecl` there.
//
// THIS CASE FAILS ON BASE, and it fails as a WRONG REFUSAL rather than as
// an ICE:
//
//   SC1030: the reference to 'x' above its 'var' declaration (a read there
//   would be 'undefined', which the binding's type cannot hold -- annotate
//   it '| undefined' or move the declaration up) is not supported yet
//   (instantiating 'pick' with <string>)
//
// Every word of that is false for this program. The reference is BELOW the
// declaration, the read is not `undefined`, and there is nothing to
// annotate. The diagnostic even names the instantiation it is unhappy
// about -- always the second, never the first -- which is the bug
// describing itself. Resolution failed in instance 1 (the slot lives in
// instance 0's frame), and `predeclareForwardVar` then declined to mint a
// forward slot because the Lowerer-wide memo answered "already hoisted"
// for a DIFFERENT instance. So the reference landed on the
// unresolved-symbol fence.
//
// 4181's npm-static twin reaches IR validation instead and reports
// SC9001. One bug, two faces; this is the one an ordinary TypeScript
// program can hit -- and THREE callers, not two: implicit-any JS
// monomorphization (4181), generic FUNCTIONS (rows below), and generic
// CLASSES (R8), which mint their instances in lower-classes.ts.
//
// CONTROLS, which behave identically on base: `cLet`/`cConst` (block
// scoped bindings never enter hoistVarBinding at all) and `cOne` (the
// same `var` shape instantiated at ONE type argument). A guard that only
// holds after the change proves nothing.

// R1: a `var` read twice, two instantiations.
function pick<T>(a: T, b: T): string {
    var x = typeof a
    if (x !== "object") return x + ":" + String(b)
    return "obj:" + x
}

// R2: the `var` is read ZERO times.
function unread<T>(a: T): string {
    var x = typeof a
    return "u" + String(a).length
}

// R3: read exactly ONCE. The read count is not the discriminator; the
// number of instantiations is.
function once<T>(a: T): string {
    var x = typeof a
    return x
}

// R4: THREE instantiations of one body.
function three<T>(a: T): string {
    var x = typeof a
    return x + "/" + x
}

// R5: two declarators in ONE `var` statement -- two slots per instance.
function pair<T>(a: T): string {
    var p = typeof a, q = "Q"
    return p + q + p
}

// R6: a `var` written in a LOOP, read after it. One function-scoped slot
// per instance, re-assigned and never reset; `i` outlives the loop, which
// is the proof it is function-scoped and not a fresh per-pass binding.
// (`t` is NOT read after the loop: tsc's flow analysis rejects that in a
// .ts file with SC0001 "used before being assigned", which is a
// pre-existing checker rule and not this case's subject. 4181's JS twin
// does read it.)
function looped<T>(a: T): string {
    var out = ""
    for (var i = 0; i < 3; i++) { var t = typeof a; out = out + t.charAt(0) }
    return out + ":" + i
}

// R7: a genuine FORWARD reference -- `peek` is created above the
// declaration and reads the slot before it is assigned, so the slot must
// hold `undefined` from frame entry. This is the arm `predeclareForwardVar`
// owns, and on base the second instantiation refuses it while the first
// accepts it.
function forward<T>(a: T): string {
    const peek = (): string => String(late)
    const before = peek()
    var late: string | undefined = typeof a
    return before + "|" + peek()
}

// R8: a GENERIC CLASS. `lower-classes.ts` mints its own
// `${family}%${ordinal}` instances and lowers each instance's METHOD
// bodies, which is a third caller of the same hoistVarBinding -- neither
// the npm-static implicit-any path nor the generic-FUNCTION path. On base
// the second class instantiation is refused with the same false SC1030
// ("instantiating class 'Box' with <string>"), and the first is accepted.
class Box<T> {
    v: T
    constructor(v: T) { this.v = v }
    describe(): string {
        var k = typeof this.v
        if (k !== "object") return k + "=" + String(this.v)
        return "obj:" + k
    }
    // A second method with its own `var`, so the per-instance slot is not
    // pinned by a single method's luck.
    tagged(): string {
        var t = typeof this.v
        var n = t.length
        return t + "#" + n
    }
}

// CONTROL for R8: a generic class whose method uses `let`.
class LetBox<T> {
    v: T
    constructor(v: T) { this.v = v }
    describe(): string {
        let k = typeof this.v
        return k + "!"
    }
}

// CONTROLS
function cLet<T>(a: T): string {
    let x = typeof a
    if (x !== "object") return x + "!"
    return "obj!"
}
function cConst<T>(a: T): string {
    const x = typeof a
    return x + "/" + x
}
function cOne<T>(a: T): string {
    var x = typeof a
    return x + "#"
}

console.log("pickNum   " + pick<number>(1, 2))
console.log("pickStr   " + pick<string>("a", "b"))
console.log("unreadNum " + unread<number>(12345))
console.log("unreadStr " + unread<string>("ab"))
console.log("onceNum   " + once<number>(1))
console.log("onceStr   " + once<string>("a"))
console.log("threeNum  " + three<number>(1))
console.log("threeStr  " + three<string>("a"))
console.log("threeBool " + three<boolean>(true))
console.log("pairNum   " + pair<number>(1))
console.log("pairStr   " + pair<string>("a"))
console.log("loopNum   " + looped<number>(1))
console.log("loopStr   " + looped<string>("a"))
console.log("fwdNum    " + forward<number>(1))
console.log("fwdStr    " + forward<string>("a"))
console.log("cLetNum   " + cLet<number>(1))
console.log("cLetStr   " + cLet<string>("a"))
console.log("cConstNum " + cConst<number>(1))
console.log("cConstStr " + cConst<string>("a"))
console.log("cOneNum   " + cOne<number>(1))
const bn = new Box<number>(7)
const bs = new Box<string>("qq")
console.log("boxNum    " + bn.describe())
console.log("boxStr    " + bs.describe())
console.log("tagNum    " + bn.tagged())
console.log("tagStr    " + bs.tagged())
const ln = new LetBox<number>(1)
const ls = new LetBox<string>("a")
console.log("cBoxNum   " + ln.describe())
console.log("cBoxStr   " + ls.describe())
