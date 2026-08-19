// A generated record walker reads the ENTRY, not the key it just enumerated.
//
// Every compiler-generated walker over an index-signature record used to
// snapshot the overflow map's keys (`recordOvfKeys`) and then read each
// value BACK OUT of that same map by that key. The read-back routes through
// the shape's dynamic-keyed read helper `sc_rkg_<n>`, whose MISS path, on a
// value width with no undefined to answer, is
//
//     scr_trap_fmt("scriptc: TypeError: record has no key '%.*s' ...")
//
// an untagged process abort past every catch clause. In zapo's emitted TU
// that read-back stood for FIFTEEN of the sixty-six remaining ABORT.real
// call sites - six `%rec.merge` (object spread), three `%rec.capture`
// (index reshape), two `Object.values`, two `Object.entries`, one
// `%obj.assign` and one `%env.pairs` - the single largest group, and every
// one of them unreachable: the key came out of the very map it was being
// looked up in, and nothing in those loops writes to that map.
//
// "Unreachable" was not good enough. It is a property of the LOOP AROUND
// the read, not of the read, so it has to be re-derived by hand at every
// site and it cannot be checked by the compiler. Deleting the trap or
// swapping in __builtin_unreachable would trade a loud failure for
// undefined behaviour, which is worse than the trap.
//
// So the walkers stopped asking. `recordOvfSlots` enumerates the same
// entries in the same JS own-key order as SLOT INDICES, and
// `recordOvfSlotGet` takes the key and the value out of the entry that
// index names. There is no lookup, so there is no miss to answer, and the
// helper those walkers used to call is simply not called any more. The
// trap it carries is untouched: it is interned per (shape, width) and
// shared with call sites that really can miss.
//
// The answers below do not change - that is the point of the file. It is
// the regression net for the new IR, and it covers what the slot spelling
// newly depends on: JS own-key ORDER across integer-like and string keys,
// TOMBSTONES (a deleted key leaves a dead entry the slot list must skip),
// an append AFTER a delete (scr_map_set only ever appends, so live slot
// indices survive it), map GROWTH past the initial capacity, the f64, bool,
// string and record value accessors, `Object.assign(x, x)` where the target
// IS the enumerated record, and the empty map.

interface Leaf { readonly tag: string }
type RecS = Record<string, string>
type RecL = Record<string, Leaf>
type RecN = Record<string, number>
type RecB = Record<string, boolean>

function mk(): RecS {
  const o: RecS = {}
  o["b"] = "B"
  o["2"] = "TWO"
  o["a"] = "A"
  o["10"] = "TEN"
  o["0"] = "ZERO"
  return o
}

// --------------------------------------------------- r01 %rec.merge order
const s1 = mk()
const sp: RecS = { ...s1 }
console.log("r01", JSON.stringify(sp))

// ------------------------------------------ r02/r03 %obj.keys/values/entries
console.log("r02", Object.keys(s1).join(","), Object.values(s1).join(","))
console.log("r03", JSON.stringify(Object.entries(s1)))

// --------------------------------- r04 %rec.declmerge (a DECLARED target)
// The overflow walk here feeds a PER-KEY DISPATCH that fills the target's
// declared fields and drops every key the target does not declare - a
// different consumer of the same enumeration, and the one that reads the
// value into a local before dispatching on the key.
interface WithAZ { a: string; z: string }
const dm: WithAZ = { a: "A0", ...s1, z: "Z" }
console.log("r04", dm.a, dm.z)

// ----------------------------------------- r05 %obj.assign, fresh target
const t1: RecS = {}
Object.assign(t1, s1)
console.log("r05", JSON.stringify(t1))

// --- r06 %obj.assign where the TARGET IS THE ENUMERATED RECORD. Every key
// of the source is already a key of the target, so each write takes
// scr_map_set's in-place branch and never appends - the one thing that
// could renumber a live slot.
const t2 = mk()
Object.assign(t2, t2)
console.log("r06", JSON.stringify(t2))

// --- r07 TOMBSTONES: `delete` marks an entry dead in place (the bucket
// chain stays intact), so the slot list must skip it and the surviving
// indices must still name the right entries.
const s2 = mk()
delete s2["a"]
delete s2["2"]
console.log("r07", Object.keys(s2).join(","), JSON.stringify({ ...s2 }))

// --- r08 an append AFTER a delete. scr_map_set appends at nentries and
// never renumbers; a compaction can only happen while making room, which
// is before any slot list of this walk exists.
const s3 = mk()
delete s3["b"]
s3["c"] = "C"
s3["b"] = "B2"
console.log("r08", Object.keys(s3).join(","), JSON.stringify({ ...s3 }))

// --- r09 a COMPOSITE value width (the +1 ref accessor), and the identity
// the spread must preserve: the walker moves the value the map holds.
const l1: Leaf = { tag: "one" }
const rl: RecL = {}
rl["x"] = l1
rl["1"] = { tag: "num" }
const rl2: RecL = { ...rl }
const gx = rl2["x"]!
console.log("r09", Object.keys(rl2).join(","), gx.tag, gx === l1)

// ------------------------------- r10 the f64 and bool value accessors
const rn: RecN = {}
rn["b"] = 2
rn["1"] = 1.5
const rb: RecB = {}
rb["t"] = true
rb["0"] = false
console.log("r10", JSON.stringify({ ...rn }), JSON.stringify({ ...rb }))

// ------------------------------------------------- r11 the EMPTY map
const e1: RecS = {}
console.log("r11", Object.keys(e1).length, JSON.stringify({ ...e1 }))

// -------------------- r12 GROWTH past the 8-entry initial entry capacity
const big: RecN = {}
for (let i = 0; i < 40; i++) big["k" + String(i)] = i
const big2: RecN = { ...big }
console.log("r12", Object.keys(big2).length, big2["k39"], Object.keys(big2)[0])

// ------------------------------------------- r13 integer-like keys ONLY
const ints: RecS = {}
ints["30"] = "thirty"
ints["4"] = "four"
ints["100"] = "hundred"
console.log("r13", Object.keys(ints).join(","), JSON.stringify({ ...ints }))

// ------------------------------------- r14 two spread contributors, in order
const c1: RecS = {}
c1["p"] = "P"
const c2: RecS = {}
c2["q"] = "Q"
c2["p"] = "P2"
console.log("r14", JSON.stringify({ ...c1, ...c2 }))
