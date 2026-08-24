// @dynamic
// The half of the string representation the STATIC lane never touches.
//
// 6300 drives every static string surface and, on the LLVM backend, emits
// ZERO inline `ScrStr` field accesses: every operation there goes through a
// `scr_str_*` runtime call, so not one of the backend's fifteen hardcoded
// `%ScrStr` layout sites is reached. Reverting all seven of its raw
// `->data` byte offsets from 12 back to 24 left 6300 byte-exact against
// Node. A representation test that cannot fail is not a test, and this file
// is what makes those sites fail.
//
// The dyn island is where the backend reads an ScrStr INLINE rather than
// calling into C: `strParts` (dyn.ts) takes a string's data and length apart
// to build a dyn, and `putScrStr` (walkers.ts) writes one back out. A
// `@dynamic` program emits both — this one emits 11 raw `i64 12` offsets and
// 10 typed `%ScrStr` GEPs where 6300 emits none.
//
// The three sites this still does not reach are the TLS-PEM
// (LIB_FN_ARG_STRDATA / pemDataLen) and native-FFI argument paths, which the
// tls and native harness lanes own.

// ── strings crossing INTO the island ─────────────────────────────────
const ascii = "abc"
const latin = "café"
const cjk = "日本語"
const astral = "a😀b"

const conf = { name: latin, tag: cjk, emoji: astral, empty: "", n: 7 }
console.log(JSON.stringify(conf))

const anyConf: any = conf
console.log(`${anyConf.name}`, `${anyConf.tag}`, `${anyConf.emoji}`, `${anyConf.n}`)
console.log(`${anyConf.empty}`.length, `${anyConf.name}`.length)

// Built NATIVELY in the island: these strings are minted on the dyn side and
// read back out, so both directions of the layout are exercised.
const native: any = { a: "café", b: "日本語", c: "a😀b", d: "", e: "x" }
console.log(`${native.a}`, `${native.b}`, `${native.c}`)
console.log(JSON.stringify(native))

// ── JSON.parse: strings minted inside the island from bytes ──────────
const parsed: any = JSON.parse('{"k":"café","u":"\\u00e9\\ud83d\\ude00","arr":["x","日本語",""],"n":3}')
console.log(`${parsed.k}`, `${parsed.n}`, `${parsed.arr[1]}`, `${parsed.arr[2]}`.length)
console.log(JSON.stringify(parsed))
console.log(`${parsed.u}`.length, `${parsed.k}`.length)

// ── round-tripping a string back to the static side ──────────────────
const backOut: string = `${parsed.k}`
console.log("back", backOut === latin, backOut.length, backOut.charCodeAt(3))
console.log("concat", backOut + "-" + `${native.b}`)
console.log("slice", backOut.slice(1, 3), `${native.c}`.slice(0, 2).length)

// ── a string as a KEY on the dyn side ────────────────────────────────
const bag: any = {}
bag[latin] = 1
bag["10"] = 2
bag["2"] = 3
bag[""] = 4
bag[cjk] = 5
// Enumeration is deliberately NOT tested here. `Object.keys` has no
// scriptc lowering (SC2020) and for-in over an `any` receiver is
// refused too (SC1052), so any enumeration of this bag makes the whole
// program fail to compile - which is exactly what it did, silently,
// until llvm-differential caught it. What this block is FOR is that a
// string minted in the island works as a key: stored, hashed, compared
// and read back. That is tested below, per key, including the empty
// string, the integer-like keys and the CJK one.
console.log("bag", JSON.stringify(bag))
console.log("read", `${bag["café"]}`, `${bag[""]}`, `${bag["10"]}`,
            `${bag["2"]}`, `${bag[cjk]}`, `${bag[latin]}`)

// ── the immortal statics, seen from the island ───────────────────────
// The empty string and every single ASCII char are immortal statics in the
// runtime; a dyn holding one must not try to free it, and one crossing back
// must still compare equal to a heap string of the same bytes.
const one: any = ascii.charAt(1)
console.log("one", `${one}`, `${one}`.length, `${one}` === "b")
const emptyDyn: any = "xy".slice(0, 0)
console.log("emptyDyn", JSON.stringify(`${emptyDyn}`), `${emptyDyn}`.length)
const boolDyn: any = String(true)
console.log("bool", `${boolDyn}`, `${boolDyn}`.length)

// ── many strings, so a wrong offset cannot hide in one lucky read ────
// `any[]` has no static representation in this build (SC2011), so the bulk
// population is minted INSIDE the island by JSON.parse and read back out.
let src = '{"rows":['
for (let i = 0; i < 60; i++) {
  if (i > 0) src += ","
  src += '{"id":"id-' + i + '","txt":"caf\u00e9' + i + '","big":"' + "y".repeat(i) + '"}'
}
src += ']}'
const many: any = JSON.parse(src)
console.log("rows", `${many.rows[0].id}`, `${many.rows[59].txt}`, `${many.rows[40].big}`.length)
console.log("rows-json", JSON.stringify(many.rows[3]), JSON.stringify(many.rows[59]).length)
let acc = 0
for (let i = 0; i < 60; i++) acc += `${many.rows[i].txt}`.length + `${many.rows[i].big}`.length
console.log("acc", acc)
console.log("src", src.length, JSON.stringify(many).length)
