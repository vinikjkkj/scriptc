// THE KEY ORDERS THE RECORD MODEL ALREADY GETS RIGHT, pinned.
//
// A record is a monomorphic struct with no per-instance key list, so its own
// keys are its SHAPE's: `fields` for the set, `declaredOrder` for the order.
// Three families escape that, and they escape it for the same reason - their
// keys live somewhere that keeps real insertion order:
//
//   an INDEX-SIGNATURE value's keys live in a per-instance overflow map, so
//   keyed writes append and `delete` + re-add moves a key to the END, both
//   exactly as Node does;
//   a plain DYN object's keys live in the checked-dynamic entry table, which
//   is insertion-ordered by construction;
//   INTEGER-LIKE names are hoisted and sorted at intern time (esOwnKeyOrder),
//   so they lead in ascending numeric order however they are spelled.
//
// And the fourth family is the ordinary one: a literal spelled the way its
// shape enumerates, which is right on every surface at once.
//
// This is the CONTROL for the per-instance key-order work. Making a
// materialised record remember the order its dynamic source carried must not
// disturb any row here, and every row is a surface that would move if it did:
// Object.keys/values/entries, JSON.stringify and for-in all read one order
// source, so one of them regressing means all of them have.

const bag: Record<string, number> = {}
bag["b"] = 1
bag["a"] = 2
bag["c"] = 3
console.log("insert   =" + Object.keys(bag).join(","))
delete bag["b"]
bag["b"] = 9
console.log("re-add   =" + Object.keys(bag).join(","))
console.log("bagjson  =" + JSON.stringify(bag))
let bagin = ""
for (const k in bag) bagin += k + ";"
console.log("bagforin =" + bagin)

interface T { z: string; "2": string; "10": string }
const t: T = { z: "Z", "10": "ten", "2": "two" }
console.log("intfirst =" + Object.keys(t).join(","))
console.log("intjson  =" + JSON.stringify(t))

interface R { a: string; b: string; c: string }
const r: R = { a: "A", b: "B", c: "C" }
console.log("inorder  =" + Object.keys(r).join(","))
console.log("values   =" + Object.values(r).join(","))
console.log("entries  =" + Object.entries(r).map((e) => e[0] + e[1]).join(","))
console.log("json     =" + JSON.stringify(r))
let rin = ""
for (const k in r) rin += k + ";"
console.log("forin    =" + rin)

const dyn: unknown = JSON.parse('{"q":1,"p":2,"z":3}')
console.log("dynkeys  =" + Object.keys(dyn as Record<string, number>).join(","))
console.log("dynjson  =" + JSON.stringify(dyn))
