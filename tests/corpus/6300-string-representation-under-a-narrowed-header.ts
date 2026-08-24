// Every observable a string has, driven over the representation that holds
// it. `ScrStr`'s header went from three `size_t` to three `uint32_t` — 24
// bytes to 12 — which moves `len` from offset 8 to 4, `cap` from 16 to 8 and
// `data` from 24 to 12, and changes the immortal-literal sentinel from
// SIZE_MAX to UINT32_MAX. Four separate places encode that layout: the C
// runtime's type, the five immortal statics inside scr_string.c, the C
// backend's literal table, and the LLVM backend's `%ScrStr` plus its raw
// byte offsets. NONE of the four is checked against the others by any
// compiler — an immortal literal is an anonymous struct cast to `ScrStr *`,
// and the LLVM backend writes its own offsets as integers. A mismatch is a
// type pun that builds clean and reads every string in the program at the
// wrong offset.
//
// So this file is not "does concatenation work". It is: every consumer that
// reads `len`, every consumer that reads `data`, every path that mints an
// IMMORTAL rather than a heap string, and every place a string is a KEY.
// Each one prints, so a wrong answer is a differing line and never a silent
// pass. It must be byte-exact against Node on BOTH backends, and it passes
// on the base revision too — nothing here is new behaviour.
//
// The immortal statics are called out because they are the ones with no
// compile-time link to the type at all:
//   scr_lit_empty   ""                      (scr_str_empty)
//   scr_ascii1[128] every 1-byte ASCII      (charAt/slice/split churn)
//   scr_lit_fffd    U+FFFD                  (lone-surrogate stand-in)
//   scr_lit_true / scr_lit_false            (String(boolean))
// and the emitted `sc_lit_N` table, which is every literal in this file.

const nl = "\n"

// ── 1. length, over ASCII, 2-byte, 3-byte and ASTRAL input ───────────
// `.length` is UTF-16 units over UTF-8 storage, so it reads `len` and then
// walks `data`. An astral char is 4 bytes and 2 units: the one case where
// byte length and unit length disagree by more than the encoding.
const ascii = "abc"
const latin = "café"
const cjk = "日本語"
const astral = "a😀b"
const mixed = "π😀é語z"
console.log("len", ascii.length, latin.length, cjk.length, astral.length, mixed.length)

// ── 2. charCodeAt / codePointAt / at / indexing ──────────────────────
// charCodeAt returns the UTF-16 CODE UNIT, so an astral char answers a
// surrogate half; codePointAt answers the whole code point at a lead.
const codes: number[] = []
for (let i = 0; i < astral.length; i++) codes.push(astral.charCodeAt(i))
console.log("charCodeAt", codes.join(","))
// `string.codePointAt` has NO scriptc lowering (SC2020) and refuses at
// compile time. The code-POINT surface that does lower is for..of, which
// yields whole characters - the astral char comes back as one 2-unit string,
// not as two surrogate halves.
const cps: string[] = []
for (const ch of astral) cps.push(ch + ":" + ch.length)
console.log("cp-iter", cps.join(","))
console.log("charAt", astral.charAt(0), astral.charAt(1), astral.charAt(2), astral.charAt(3))
console.log("index", astral[0], astral[3], mixed[1])
// `astral[99]` is a documented divergence ("" here, undefined in Node) and
// is deliberately not printed; charAt agrees.
console.log("oob", astral.charCodeAt(99), JSON.stringify(astral.charAt(99)),
  JSON.stringify("abc".charAt(3)), "abc".charCodeAt(3))

// ── 3. slice / substring / at, including through a surrogate pair ────
console.log("slice", mixed.slice(0, 2), "|", mixed.slice(1, 3), "|", mixed.slice(-2))
console.log("substring", mixed.substring(2, 4), "|", mixed.substring(4, 2))
// The empty-separator split of an ASTRAL char is a documented divergence
// (U+FFFD per half here, lone surrogates in Node), so the CONTENT is checked
// on a BMP string - which is the path that returns the runtime's immortal
// single-ASCII statics - and only the astral COUNT is checked.
console.log("split-empty", astral.split("").length, JSON.stringify(latin.split("")))
console.log("split-empty2", JSON.stringify("aXb".split("")), cjk.split("").length)
console.log("split-sep", "a,b,,c".split(",").join("|"))

// ── 4. concatenation ─────────────────────────────────────────────────
// Three distinct allocator paths, and the header change touches all of
// them: the in-place arm (rc == 1 and cap >= newlen, which reads `cap`),
// the geometric-slack copy arm, and the short-result constant slack.
let acc = ""
for (let i = 0; i < 40; i++) acc += "x" + i
console.log("append", acc.length, acc.slice(0, 12), acc.slice(-6))
const shared = "prefix-"
console.log("chain", shared + "a" + "b" + "c", (shared + latin + astral).length)
let big = "z"
for (let i = 0; i < 12; i++) big = big + big
console.log("double", big.length, big.charAt(0), big.charAt(big.length - 1))

// ── 5. comparison, equality and SORT ORDER ───────────────────────────
// scr_str_eq short-circuits on pointer identity, so interning and equality
// must not be confusable; scr_str_cmp_u16 compares UTF-16 code units over
// UTF-8 bytes, which differs from byte order exactly at U+E000..U+FFFF
// against an astral char.
const asciiAny: string = ascii
console.log("eq", "abc" === "ab" + "c", latin === "café", asciiAny === cjk)
console.log("cmp", "a" < "b", "Z" < "a", cjk < astral, "" < "a")
const words = ["banana", "Apple", "apple", "", "日本", "😀", "", "apple pie", "z"]
console.log("sort", JSON.stringify(words.slice().sort()))
console.log("localeish", JSON.stringify(["b", "a", "C", "A"].sort()))

// ── 6. IDENTITY versus equality on interned values ───────────────────
// Every literal in this file is one immortal static; the empty string and
// each single ASCII char are immortal statics INSIDE the runtime, returned
// by charAt/slice without allocating. A heap string built to the same bytes
// must still compare equal — and `===` on strings is value equality in JS,
// so the answer is the same either way. That is the point: the two kinds of
// ScrStr must be indistinguishable to the program.
const heapEmpty = "ab".slice(0, 0)
const litEmpty = ""
console.log("empty", heapEmpty === litEmpty, heapEmpty.length, JSON.stringify(heapEmpty))
const heapA = "xax".charAt(1)
console.log("one-char", heapA === "a", heapA.length, heapA.charCodeAt(0))
const built = "c" + "a" + "f" + "é"
console.log("built", built === latin, built.length)
console.log("bool-str", String(true), String(false), true + "", ("" + false).length)

// ── 7. template literals ─────────────────────────────────────────────
const who = "world"
const num = 42
console.log(`tpl ${who} ${num} ${latin.length} ${astral}`)
console.log(`nested ${`${who}!`}${""}`)

// ── 8. JSON.stringify escaping, and JSON.parse round-trip ────────────
// stringify walks `data` byte by byte and writes into a builder whose grown
// capacity lands back in `cap`.
// `e` is U+0001 and is written as an ESCAPE deliberately. It is the
// control character JSON must emit as \u0001, so it belongs in an
// escaping test - but as a RAW 0x01 byte in the source it is
// indistinguishable from a mangling accident, which is how a later
// reader would "fix" it. The escape is the same value and says so.
console.log("json", JSON.stringify({ a: latin, b: astral, c: cjk, d: '"\\\n\t', e: "\u0001" }))
console.log("json-arr", JSON.stringify([ascii, "", "a b"]))
const round = JSON.parse(JSON.stringify({ k: mixed })) as { k: string }
console.log("round", round.k === mixed, round.k.length)

// ── 9. composed against decomposed ───────────────────────────────────
// `String.prototype.normalize` has no scriptc lowering (SC2020) and REFUSES
// at compile time, so it cannot be driven here. What can be, and is what the
// representation actually decides, is that the composed and decomposed forms
// are different byte strings of different lengths that must not be conflated
// by an equality that reads the wrong `len`.
const nfc = "é"
const nfd: string = "é"
console.log("nfc-nfd", nfc.length, nfd.length, nfc === nfd, nfc.charCodeAt(0),
  nfd.charCodeAt(0), nfd.charCodeAt(1))
console.log("nfc-bytes", Buffer.from(nfc, "utf8").length, Buffer.from(nfd, "utf8").length)

// ── 10. regex over the changed representation ────────────────────────
console.log("regex", /c.f/.test(latin), /^\d+$/.test("12345"), "a1b22c".replace(/\d+/g, "#"))
const m = "key=value; other=2".match(/(\w+)=(\w+)/)
console.log("match", m === null ? "null" : m[0] + "|" + m[1] + "|" + m[2])
for (const mm of "key=value; other=2".matchAll(/(\w+)=(\w+)/g)) {
  console.log("matchAll", mm[0], mm[1], mm[2], mm.index)
}
console.log("split-re", "a1b22c333d".split(/\d+/).join("-"))
console.log("replace-fn", "abc".replace(/b/, (s) => s.toUpperCase()))

// ── 11. Buffer round-trips ───────────────────────────────────────────
const buf = Buffer.from(mixed, "utf8")
console.log("buf", buf.length, buf.toString("utf8") === mixed, buf.toString("hex").slice(0, 16))
console.log("buf-b64", Buffer.from(latin, "utf8").toString("base64"),
  Buffer.from("Y2Fmw6k=", "base64").toString("utf8") === latin)

// ── 12. every place a string is a KEY ────────────────────────────────
// Key ORDER is part of the answer: integer-like keys first in numeric
// order, then insertion order for the rest.
const obj: Record<string, number> = {}
obj["b"] = 1
obj["10"] = 2
obj["2"] = 3
obj["a"] = 4
obj[latin] = 5
obj[astral] = 6
obj[""] = 7
console.log("obj-keys", JSON.stringify(Object.keys(obj)))
console.log("obj-json", JSON.stringify(obj))
console.log("obj-read", obj["café"], obj[""], obj["10"], obj[cjk] === undefined)

const map = new Map<string, number>()
map.set("b", 1)
map.set("10", 2)
map.set(latin, 3)
map.set("", 4)
map.set("b", 5) // overwrite, not append: the key must hash and compare equal
const mk: string[] = []
map.forEach((_v, k) => mk.push(k))
console.log("map-keys", JSON.stringify(mk), map.size, map.get("café"), map.get("b"))
// A key built at run time must find a key stored as a literal.
console.log("map-built", map.get("ca" + "f" + "é"), map.has("" + ""))

const set = new Set<string>()
set.add("a")
set.add("a")
set.add(heapA)
set.add(astral)
console.log("set", set.size, set.has("a"), set.has("a\u{1F600}b"))

// ── 13. the U+FFFD immortal, and padding ─────────────────────────────
// An empty-separator split of an astral char and a pad fill truncated
// mid-pair both return the runtime's one immortal U+FFFD static.
const halves = astral.split("")
console.log("halves", halves.length, halves[0], halves[3], halves[1].length,
  halves[2].length)
console.log("pad", "x".padStart(5, "😀"), "|", "x".padEnd(4, "ab"), "|", "xyz".padStart(2, "-"))
console.log("repeat", "ab".repeat(3), "-".repeat(0).length, latin.repeat(2).length)

// ── 14. the rest of the read surface ─────────────────────────────────
console.log("case", latin.toUpperCase(), cjk.toLowerCase(), "STRASSE".toLowerCase())
console.log("trim", JSON.stringify("  a b  ".trim()), JSON.stringify(" x ".trimStart()),
  JSON.stringify(" x ".trimEnd()))
console.log("find", mixed.indexOf("😀"), mixed.lastIndexOf("z"), latin.includes("fé"),
  cjk.startsWith("日"), cjk.endsWith("語"))
console.log("cp", String.fromCharCode(65, 0xd83d, 0xde00), String.fromCodePoint(0x1f600).length)
console.log("wellformed", "abc".isWellFormed(), astral.isWellFormed())
console.log("num", Number("42").toString(), (255).toString(16), (1.5).toFixed(3))

// ── 15. long strings: past the pool ceiling and past every size class ─
// The pooled range is `sizeof(ScrStr) + cap + 1 <= SCR_POOL_MAX (256)`, so
// the boundary MOVES with the header: caps up to 231 before, up to 243
// after. This sweep straddles it on both sides and checks the content of
// every result, so a block handed back to the wrong size class is a wrong
// answer here and not a leak nobody sees.
let hash = 0
for (let n = 1; n <= 300; n++) {
  const s = "y".repeat(n)
  if (s.length !== n) console.log("BAD length at " + n)
  const t = s + "!"
  if (t.length !== n + 1 || t.charAt(n) !== "!") console.log("BAD concat at " + n)
  hash = (hash * 31 + s.length + t.charCodeAt(0)) % 1000003
}
console.log("sweep", hash)

// ── 16. a string that outlives every temp that made it ───────────────
const kept: string[] = []
for (let i = 0; i < 50; i++) kept.push("k" + i + "-" + latin)
console.log("kept", kept.length, kept[0], kept[49], kept[7].length)
process.stdout.write("done" + nl)
