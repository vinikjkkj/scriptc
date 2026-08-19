// The three places the runtime now takes a shortcut on the hot path, and
// the boundaries where each shortcut has to stop.
//
// Nothing here is new SEMANTICS. All three changes are performance-only, so
// this program CANNOT fail on base and does not try to: the corpus contract
// is that the compiled output is byte-identical to Node's, and Node is the
// oracle for every line below. It exists so that the boundaries the three
// shortcuts are guarded at are walked by something other than a benchmark.
//
//   1. Number -> string takes an integer fast path for 1 <= x < 2^53 and
//      falls back to Ryu otherwise. The interesting values are the ones on
//      either side of 2^53, the ones where the SHORTEST round-tripping
//      string stops being the exact decimal expansion (2^63, 2^64), the
//      ones where placement switches to exponent form (1e21), the trailing
//      -zero cases the fast path prints directly and Ryu folds into an
//      exponent, and every one of NaN, +-Infinity, -0 and the negatives.
//
//   2. A parsed JSON object's own keys now come from a size-class pool
//      keyed on the stored key_len. Keys of every length, keys needing the
//      escape-decoding slow path, duplicate keys (later wins), keys deleted
//      and re-added, and objects released and re-parsed so blocks recycle.
//
//   3. A concat whose LEFT side is shared gets a little capacity slack so
//      the next link of the chain can append in place. That mutates a
//      string the caller already holds a reference to if the reference
//      count is wrong, so the chains below deliberately keep the
//      intermediate alive and read it after the next link is built.

// -- 1. Number -> string across the fast path's boundary ---------------
const nums: number[] = [
  0, -0, 1, -1, 9, 10, 99, 100, 12345, 1234567, 1700000000,
  1e6, 1e15, 1e16, 1e20, 1e21, 1e-6, 1e-7,
  9007199254740990, 9007199254740991, 9007199254740992, 9007199254740993,
  9223372036854775808, 18446744073709551616,
  0.5, -0.5, 123.456, 1 / 3, 0.1 + 0.2,
  NaN, Infinity, -Infinity,
  -9007199254740991, -1700000000, -1e21,
]
for (const n of nums) console.log("num", n, String(n), "" + n, `${n}`)
for (let i = 0; i < 40; i++) {
  const p = Math.pow(10, i)
  console.log("pow", i, String(p), String(p - 1), String(p + 1), String(-p))
}
let acc = ""
for (let i = 0; i < 25; i++) acc += String(2 ** i) + ","
console.log("pow2", acc, acc.length)

// -- 2. JSON object keys of every length, through the pool -------------
function build(klen: number, n: number): string {
  let s = "{"
  for (let j = 0; j < n; j++) {
    if (j > 0) s += ","
    let k = ""
    for (let c = 0; c < klen; c++) k += String.fromCharCode(97 + ((c + j) % 26))
    s += '"' + k + '":' + (j * 7 + klen)
  }
  return s + "}"
}
let keysum = 0
for (let round = 0; round < 3; round++) {
  for (let klen = 1; klen <= 40; klen++) {
    const text = build(klen, 5)
    const o = JSON.parse(text) as Record<string, number>
    const ks = Object.keys(o)
    for (const k of ks) keysum += k.length + o[k]!
    console.log("keys", klen, ks.length, ks.join("|"), JSON.stringify(o))
  }
}
console.log("keysum", keysum)

// duplicate keys (later wins), escaped keys (the decode slow path),
// deletion and re-insertion
const dup = JSON.parse('{"a":1,"b":2,"a":3}') as Record<string, number>
console.log("dup", JSON.stringify(dup), Object.keys(dup).join(","))
const esc = JSON.parse('{"a\\u0062c":1,"tab\\there":2,"q\\\"q":3,"sl\\\\ash":4}') as Record<string, number>
console.log("esc", JSON.stringify(esc), Object.keys(esc).join("|"))
const mut: Record<string, number> = JSON.parse('{"one":1,"two":2,"three":3}')
delete mut["two"]
mut["four"] = 4
mut["one"] = 11
console.log("mut", JSON.stringify(mut), Object.keys(mut).join(","))

// the shape the messaging workload actually parses
for (let i = 0; i < 50; i++) {
  const wire =
    '{"key":{"remoteJid":"5511' + (900000000 + i) + '@s.whatsapp.net","fromMe":true,' +
    '"id":"3EB0' + i + '"},"message":{"conversation":"hello-' + i + '"},' +
    '"messageTimestamp":' + (1700000000 + i) + "}"
  const parsed = JSON.parse(wire) as {
    key: { remoteJid: string; fromMe: boolean; id: string }
    message: { conversation: string }
    messageTimestamp: number
  }
  console.log("wire", parsed.key.id, parsed.key.remoteJid, parsed.message.conversation,
    parsed.messageTimestamp, JSON.stringify(parsed))
}

// -- 3. Concat chains whose left side is shared ------------------------
const parts = ["alpha", "beta", "gamma", "", "d"]
let chainsum = 0
for (let i = 0; i < 60; i++) {
  const left = parts[i % parts.length]!
  // the intermediate is kept alive and read AFTER the next link is built,
  // so an in-place append that mutated a shared string would show here
  const mid = left + "|"
  const full = mid + i
  const full2 = mid + (i * 3)
  console.log("chain", left, mid, full, full2, mid.length, full.length)
  chainsum += mid.length + full.length + full2.length
}
console.log("chainsum", chainsum)

// a literal left side, the most common shared-left shape there is
let lit = ""
for (let i = 0; i < 30; i++) lit += "x" + i + "y" + (i * 1000000) + ";"
console.log("lit", lit, lit.length)

// an append loop, which must still reach the rc == 1 arm
let app = ""
for (let i = 0; i < 200; i++) app += String(i % 10)
console.log("app", app, app.length)
