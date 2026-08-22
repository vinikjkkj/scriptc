// The ELEMENT and DOTTED spellings of `fill` / `copyWithin` on an untyped
// array — the read/call split, from the side that used to be a refusal.
//
// `dyn_kind_knows` is fed by TWO lists with `||`: the ARR arm's `impl` names
// and `dyn_arr_proto_unimpl`'s. `fill` and `copyWithin` sat in the second
// one, so `typeof a[k]` said "function" while `a[k]()` threw "not supported",
// and the DOTTED `a.fill(0)` was an SC1090 compile fence because the name was
// not in DYN_DISPATCH_METHODS either. Moving the two names from the unimpl
// list to the impl list keeps `dyn_kind_knows` answering exactly what it
// answered before — that is the whole reason the move is a move and not a
// deletion, and `scr_dyn_invoke.c` says so where `toString` made the same
// trip.
//
// This file is the guard on that: if a later tidy-up deletes a name from one
// list without adding it to the other, `typeof` and the call stop agreeing
// and one of the rows below stops matching Node.

const a = JSON.parse("[1,2,3,4,5]")
for (const k of ["fill", "copyWithin", "sort", "push", "reduce", "flat", "nope"]) {
  console.log("typeof", k, typeof a[k])
}

// the ELEMENT spelling reaches the runtime arm directly
console.log("elem fill  ", JSON.stringify(a["fill"](7, 1, 3)))
console.log("elem cw    ", JSON.stringify(a["copyWithin"](0, 3)))

// the DOTTED spelling on a dyn receiver — an SC1090 compile fence before the
// names were routed
const b = JSON.parse('["a","b","c","d"]')
console.log("dot fill   ", JSON.stringify(b.fill("z", -2)))
console.log("dot cw     ", JSON.stringify(b.copyWithin(-2, 0)))

// both answer THE RECEIVER, so a chain reads back through the same object
const c = JSON.parse("[1,2,3]")
console.log("chained    ", c.fill(0).length, JSON.stringify(c))

// the no-op arms, and an argument-free fill
const d = JSON.parse("[1,2,3]")
console.log("noop       ", JSON.stringify(d.copyWithin(0, 9)), JSON.stringify(d.fill(4, 10)))
console.log("bare fill  ", JSON.stringify(JSON.parse("[1,2]").fill()))

console.log("still running")
