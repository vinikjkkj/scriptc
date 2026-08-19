// The string block pool (scr_runtime.h scr_pool_take/scr_pool_give,
// scr_string.c scr_str_alloc/scr_str_release), driven across EVERY size
// class it has and across a BULK FREE that returns thousands of blocks at
// once — which is the shape a Map.clear() of a populated store gives it and
// the shape the pool's bound is actually measured against.
//
// What a pool defect looks like, and why each is caught here rather than by
// a smaller program:
//
//   * A block handed out for a class SMALLER than the request overruns by a
//     few bytes. The overrun lands in the NEXT block's header, so the damage
//     shows only after that block is reused. Every string below is written
//     full-width AND read back after a later allocation round has reused its
//     class, so a short block corrupts a string this program prints.
//   * The class arithmetic is `bytes/GRAIN - 1` on a rounded size. An
//     off-by-one puts a block in a neighbouring class, which is only visible
//     when a request straddles a class boundary. Lengths here step by ONE
//     byte across the whole pooled range, so every boundary is straddled.
//   * A block given back TWICE appears in one class's free list twice and is
//     then handed to two live strings. Two strings written to different
//     values would then read back equal; the checksum below is order- and
//     value-sensitive, so that collapses it.
//   * A bound that rejects a give must not lose the block: the caller frees
//     it instead. A leak is invisible to output, so this program is also a
//     leak-check fixture — run under the RC audit lane it must report zero
//     live strings at exit -- and it never calls process.exit, which would
//     take the _Exit path and skip the audit entirely.
//
// The pooled range is `sizeof(ScrStr) + cap + 1` <= SCR_POOL_MAX (256) with
// a 24-byte header, i.e. caps up to 231 bytes. The lengths below run 1..300
// so the range is covered AND overrun on both sides: the classes above 256
// are the never-pooled arm, which must keep working identically.

function make(len: number, seed: number): string {
  // A value that depends on BOTH the length and the seed, so a block handed
  // to the wrong string cannot read back right by accident.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let s = ""
  for (let i = 0; i < len; i = i + 1) {
    s = s + alphabet.charAt((i + seed * 7) % 36)
  }
  return s
}

function check(s: string, len: number, seed: number): number {
  // Fold the whole string, not a prefix: a short block corrupts the TAIL.
  if (s.length !== len) return -1
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let acc = 0
  for (let i = 0; i < len; i = i + 1) {
    if (s.charAt(i) !== alphabet.charAt((i + seed * 7) % 36)) return -2
    acc = (acc * 31 + s.charCodeAt(i)) % 1000000007
  }
  return acc
}

// ── round 1: fill every class, one length at a time ──────────────────
const store = new Map<string, string>()
let fold1 = 0
for (let len = 1; len <= 300; len = len + 1) {
  const v = make(len, len)
  const c = check(v, len, len)
  if (c < 0) {
    console.log("ROUND1 BAD len=" + len + " code=" + c)
  }
  fold1 = (fold1 * 131 + c) % 1000000007
  store.set("k" + len, v)
}
console.log("round1 size=" + store.size + " fold=" + fold1)

// ── round 2: the BULK FREE, then immediately reallocate the same shapes
// with DIFFERENT contents. Every block the clear returned is a candidate
// for the next allocation, so a mis-classed or double-given block shows up
// as a wrong character in round 2's fold.
store.clear()
let fold2 = 0
for (let len = 1; len <= 300; len = len + 1) {
  const v = make(len, len + 1)
  const c = check(v, len, len + 1)
  if (c < 0) {
    console.log("ROUND2 BAD len=" + len + " code=" + c)
  }
  fold2 = (fold2 * 131 + c) % 1000000007
  store.set("k" + len, v)
}
console.log("round2 size=" + store.size + " fold=" + fold2)

// Round 1's strings are all gone; round 2's are all live and must still
// read back after the churn below has recycled their classes many times.
const held: string[] = []
for (let len = 1; len <= 300; len = len + 1) {
  const got = store.get("k" + len)
  held.push(got === undefined ? "" : got)
}

// ── round 3: churn wider than any per-class bound ────────────────────
// 4000 allocations of one class, freed in one burst, four times over. A
// per-class DEPTH bound rejects most of these; a byte BUDGET bound rejects
// them once the budget is met. Either way every block must come back
// correct, and the held strings above must be untouched.
let churnFold = 0
for (let round = 0; round < 4; round = round + 1) {
  const tmp: string[] = []
  for (let i = 0; i < 4000; i = i + 1) {
    tmp.push(make(40 + (i % 3), i))
  }
  for (let i = 0; i < tmp.length; i = i + 1) {
    churnFold = (churnFold + tmp[i].charCodeAt(0) + tmp[i].length) % 1000000007
  }
  // dropping `tmp` at the end of the iteration is the bulk free
}
console.log("churn fold=" + churnFold)

let heldFold = 0
for (let len = 1; len <= 300; len = len + 1) {
  const c = check(held[len - 1], len, len + 1)
  if (c < 0) {
    console.log("HELD BAD len=" + len + " code=" + c)
  }
  heldFold = (heldFold * 131 + c) % 1000000007
}
console.log("held fold=" + heldFold + " (must equal round2 fold)")
console.log("held==round2 " + (heldFold === fold2))

// ── round 4: concat, which is the pool's other caller ────────────────
// `a + b` with a shared left side takes the copy path and the chain slack;
// `s += x` in a loop takes the in-place path and the one-slot spare block.
// Both end in scr_str_alloc, so both feed the pool.
const parts: string[] = []
for (let i = 0; i < 64; i = i + 1) parts.push(make(1 + (i % 9), i))
let joined = ""
for (let i = 0; i < parts.length; i = i + 1) joined = joined + parts[i] + "|"
console.log("joined len=" + joined.length)
let chainFold = 0
for (let i = 0; i < 200; i = i + 1) {
  const a = parts[i % parts.length]
  const b = parts[(i + 1) % parts.length]
  const c = parts[(i + 2) % parts.length]
  const s = a + b + c
  chainFold = (chainFold * 131 + s.length + s.charCodeAt(0)) % 1000000007
}
console.log("chain fold=" + chainFold)

// The store and `held` are still live here; the program falls off its end
// rather than calling process.exit, so the runtime teardown -- and with it
// the RC audit lane -- sees every one of these frees.
console.log("done size=" + store.size + " held=" + held.length)
