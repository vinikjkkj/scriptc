// `s.split(separator, limit)` — the second parameter of String.prototype.split.
//
// The spec's loop (22.1.3.23) stops collecting once `limit` pieces exist.
// Splitting on a STRING separator is pure, so the list it stops at is the
// full split truncated to ToUint32(limit) — the same array, element for
// element. The only thing that has to be exact is the conversion, which is
// why the lowered form takes a COMPILE-TIME limit and folds ToUint32 there.
//
// What this pins against Node:
//
//  - the ordinary truncation, including a limit LARGER than the piece count
//    (no padding, no error — just every piece) and the exact-count limit.
//  - limit 0 is Node's EMPTY array, not "no limit". This is the one every
//    naive `limit || Infinity` implementation gets wrong.
//  - ToUint32, spelled out: a FRACTIONAL limit truncates toward zero (2.9
//    keeps two pieces); NaN and both infinities become 0 (the empty array);
//    a NEGATIVE limit wraps modulo 2^32 to a huge number, so `-1` means "no
//    limit" and keeps everything.
//  - `undefined` as the explicit second argument is the unlimited split,
//    identical to omitting it.
//  - the interactions with split's own edge cases: the EMPTY separator
//    (per UTF-16 code unit), a separator that does not occur (the
//    one-element array, and what limit 0 does to it), an empty receiver,
//    leading/trailing/adjacent separators (the empty pieces are pieces and
//    count against the limit), and a multi-character separator.
//  - the result is an ordinary fresh string[]: pushing to it does not touch
//    anything else, and indexing past the truncation is undefined.

function show(parts: readonly string[]): string {
    const quoted: string[] = []
    for (const p of parts) {
        quoted.push(`'${p}'`)
    }
    return `[${quoted.join(",")}](${parts.length})`
}

const csv = "a,b,c,d"

// ── the ordinary truncation ─────────────────────────────────────────────
console.log("lim 1 ", show(csv.split(",", 1)))
console.log("lim 2 ", show(csv.split(",", 2)))
console.log("lim 3 ", show(csv.split(",", 3)))
console.log("lim 4 ", show(csv.split(",", 4)))
console.log("lim 9 ", show(csv.split(",", 9)))
console.log("no lim", show(csv.split(",")))

// ── limit 0 is the empty array, not "unlimited" ─────────────────────────
console.log("lim 0 ", show(csv.split(",", 0)))
console.log("lim 0e", show("nosep".split(",", 0)))

// ── ToUint32, spelled out ───────────────────────────────────────────────
console.log("lim 2.9 ", show(csv.split(",", 2.9)))
console.log("lim -2.9", show(csv.split(",", -2.9)))
console.log("lim -1  ", show(csv.split(",", -1)))
console.log("lim NaN ", show(csv.split(",", NaN)))
console.log("lim +Inf", show(csv.split(",", Infinity)))
console.log("lim -Inf", show(csv.split(",", -Infinity)))

// An explicit `undefined` limit is the unlimited split.
console.log("lim undef", show(csv.split(",", undefined)))

// A const initialized with a number is compile-time too.
const TWO = 2
console.log("lim TWO ", show(csv.split(",", TWO)))

// ── split's own edge cases, under a limit ───────────────────────────────
console.log("empty sep 3 ", show("hello".split("", 3)))
console.log("empty sep 0 ", show("hello".split("", 0)))
console.log("empty sep 99", show("hi".split("", 99)))
console.log("absent sep 1", show("nosep".split(",", 1)))
console.log("absent sep 5", show("nosep".split(",", 5)))
console.log("empty recv 1", show("".split(",", 1)))
console.log("empty recv 0", show("".split(",", 0)))
console.log("empty both 1", show("".split("", 1)))

// Leading / trailing / adjacent separators produce empty pieces, and those
// pieces count against the limit like any other.
console.log("lead 2  ", show(",a,b".split(",", 2)))
console.log("trail 3 ", show("a,b,".split(",", 3)))
console.log("adj 3   ", show("a,,b".split(",", 3)))
console.log("allsep 3", show(",,,".split(",", 3)))

// A multi-character separator.
console.log("multi 2", show("a::b::c".split("::", 2)))
console.log("multi 0", show("a::b::c".split("::", 0)))

// ── the result is an ordinary array ─────────────────────────────────────
const head = csv.split(",", 2)
head.push("z")
console.log("mutated", show(head), "source still", show(csv.split(",")))
console.log("indexed", head[0], head[1], head[2])
