// `d.toString(x)` on a CHECKED-DYNAMIC receiver where `x` is neither
// statically NumberLike nor a literal encoding.
//
// That argument shape is minified JS's, and it is exactly what the
// protobufjs bundle's four `Long.prototype.toString(e)` call sites look
// like: the radix is a parameter, so the checker answers `any`, the radix
// branch declines, and the call fell into bufEncoding's literal-only gate
// and fenced. Baking utf8 in would answer a byte decoding where Node
// answers hex digits.
//
// The third answer is the one the BRACKET spelling has had all along:
// scr_dyn_invoke dispatches on the RECEIVER's runtime kind. Its own source
// states the contract this restores -- "`n.toString(2)` and `n[k](2)` are
// one answer computed once".
//
// Rows 1 and 2 are the bundle's two receiver kinds (an OBJ carrying its
// own toString, and the plain numbers `o.toInt()` and `(...)>>>0` produce).
//
// CONTROLS: row 3 (no argument) and row 8 (a LITERAL encoding) are the two
// spellings that already lowered, through num.toStringRadix and
// dyn.toString respectively -- if either moves, the routing captured a
// call it should have left alone. Row 9 pins that a literal encoding which
// is NOT a Node spelling still fails at COMPILE time in a separate
// program, so it is a price rather than a row (see below).
//
// NOT A ROW HERE, and a pre-existing divergence measured on BOTH sides:
// `(255).toString("hex")` -- a dyn NUMBER receiver with a literal ENCODING
// -- answers "255" here and throws RangeError in Node. That is the
// literal-encoding path, which this change does not touch; it is recorded
// as a price, not pinned, because a corpus fixture has to match Node byte
// for byte.
//
// NOT A ROW HERE either: a FUNC receiver's toString. Node answers the
// source text; a compiled binary has none, and the runtime keeps its loud
// refusal.

const objWithToString: any = JSON.parse('{"v":255}')
const V = 255
objWithToString.toString = function (radix: any): string {
    return "L" + V.toString(radix as number)
}

const radix: any = JSON.parse("16")
const radix2: any = JSON.parse("2")
const num: any = JSON.parse("255")
const str: any = JSON.parse('"already a string"')
const arr: any = JSON.parse("[1,2,3]")
const boo: any = JSON.parse("true")
const nested: any = JSON.parse("[[1,2],[3]]")

// 1. an OBJ receiver whose own toString takes the radix -- Long's shape
console.log("objown    " + String(objWithToString.toString(radix)))

// 2. a NUM receiver with a runtime radix
console.log("numradix  " + String(num.toString(radix)))
console.log("numradix2 " + String(num.toString(radix2)))

// 3. CONTROL: the same NUM receiver with NO argument
console.log("numplain  " + String(num.toString()))

// 4. a STRING receiver ignores the argument
console.log("strarg    " + String(str.toString(radix)))

// 5. an ARRAY receiver joins, ignoring the argument
console.log("arrarg    " + String(arr.toString(radix)))
console.log("arrnest   " + String(nested.toString(radix)))

// 6. a BOOLEAN receiver ignores the argument
console.log("boolarg   " + String(boo.toString(radix)))

// 7. a BUFFER receiver with a RUNTIME encoding
const buf: any = Buffer.from("hi there")
const encHex: any = JSON.parse('"hex"')
const encAlias: any = JSON.parse('"utf-8"')
console.log("bufhex    " + String(buf.toString(encHex)))
console.log("bufalias  " + String(buf.toString(encAlias)))
console.log("bufplain  " + String(buf.toString()))

// 8. CONTROL: a LITERAL encoding on the same receiver, the path that
//    already lowered and must be unchanged
console.log("buflit    " + String(buf.toString("base64")))

// 9. a PLAIN Uint8Array is Array.prototype.toString, not a decode -- the
//    split Node makes and the one the runtime has to keep
const u8: any = new Uint8Array([104, 105])
console.log("u8arg     " + String(u8.toString(encHex)))

// 10. an unknown runtime encoding is Node's ERR_UNKNOWN_ENCODING, message
//     and all
const bad: any = JSON.parse('"nope"')
try {
    console.log("bad       " + String(buf.toString(bad)))
} catch (e) {
    console.log("bad       threw " + (e as Error).message)
}

// 11. an `undefined` argument is the same as no argument
const und: any = JSON.parse("null") === null ? undefined : 1
console.log("undefarg  " + String(buf.toString(und)))
console.log("undefnum  " + String(num.toString(und)))
