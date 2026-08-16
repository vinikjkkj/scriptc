// `arr.toString()` and `tup.toString()` -- the METHOD spelling of an
// operation the CONVERSION spelling next to it already performed.
//
// Array.prototype.toString IS join(","), and `${arr}` / String(arr)
// have lowered to exactly that intrinsic for as long as the join fence
// has existed. The method spelling did not, and it was missing in two
// different ways at once:
//
//   `[1,2].toString()`   refused, SC2020 'number[].toString' ... has no
//                        scriptc lowering yet -- a compile-time refusal
//                        for an operation the same file performs one
//                        line up as `${[1,2]}`.
//   `tup.toString()`     answered "[object Object]" -- SILENTLY, no
//                        diagnostic -- because a TUPLE is a record shape
//                        with `tuple: true` and the default-toString
//                        fold claims every record. Node prints "a,1".
//
// The two spellings now share one entry point, so they cannot disagree
// about one operation. `tmpl` and `conv` are the rows that say so: they
// were already right, they print the same text as the method rows, and
// a change that moved them would have broken the thing it was matching.
//
// UNIFORM tuples (`tup3`, `tup1`) lower their VALUE to a static array,
// so they take the array arm; a MIXED tuple (`tuple`) stays a record
// struct and snapshots its positions. `evaluated` is the row that
// proves the snapshot reads a PARAMETER: the receiver is effectful and
// it runs exactly once.
//
// Nested arrays keep the fence (`[[1,2]].toString()` is still SC2020) --
// join declines the same element type for the same reason, and the two
// must decline together or the inconsistency has only moved.

const a: number[] = [1, 2]
console.log("array   = " + a.toString())
const s: string[] = ["x", "y"]
console.log("strarr  = " + s.toString())
const b: boolean[] = [true, false]
console.log("boolarr = " + b.toString())

// Array.prototype.join prints unit arms EMPTY, and so does toString.
const h: (number | null | undefined)[] = [1, null, undefined, 2]
console.log("holes   = " + h.toString())

// The empty array is "" -- the one row where the answer is not a fold
// of anything and still has to be right.
const e: number[] = []
console.log("empty   = [" + e.toString() + "]")

// THE CONTROLS: the conversion spellings, which were already correct.
// If either of these moves, the method spelling was matched to the
// wrong thing.
console.log("tmpl    = " + `${a}`)
console.log("conv    = " + String(a))

// A MIXED tuple: a record struct, snapshotted position by position.
const t: [string, number] = ["a", 1]
console.log("tuple   = " + t.toString())

// UNIFORM tuples: the value is already a static array.
const t3: [number, number, number] = [1, 2, 3]
console.log("tup3    = " + t3.toString())
const t1: [string] = ["z"]
console.log("tup1    = " + t1.toString())

// An EFFECTFUL receiver at the mixed-tuple arm: read through a lifted
// helper's parameter, so the positions are read off one evaluation.
let n = 0
function eff(): [string, number] {
    n += 1
    return ["e", n]
}
console.log("efftup  = " + eff().toString())
console.log("evaluated = " + n)

// A tuple bound through a variable and read twice: the interned helper
// is shared, and the second read sees the same value.
const twice: [string, number] = ["t", 9]
console.log("twiceA  = " + twice.toString())
console.log("twiceB  = " + twice.toString())
