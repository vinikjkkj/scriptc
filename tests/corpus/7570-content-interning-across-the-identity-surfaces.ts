// CONTENT INTERNING: the surfaces where sharing one heap block between two
// byte-equal strings could be observed. The runtime caches concat results in
// [16, 128] BYTES and hands the cached block back instead of copying, so two
// strings a program built independently can be one object.
//
// "Strings are primitives, so `===` compares value and interning cannot
// change an observable" is TRUE and is not the whole argument. It covers
// exactly the things that ARE primitives. This file is the things that are
// not, plus the things where the runtime's own bookkeeping is keyed by the
// string's ADDRESS rather than by its bytes:
//
//   * Symbol and Symbol.for — symbol identity is the symbol object, and
//     Symbol.for's registry is keyed by string VALUE. Two symbols built from
//     two now-shared descriptions must still be distinct; two Symbol.for's
//     must still be one.
//   * Map/Set keys, object property names, Object.keys order, JSON round
//     trips — value-keyed everywhere, on both sides.
//   * The UTF-16 index cache, which is keyed by ScrStr POINTER and holds one
//     cursor per recently-touched string in four slots. Before interning two
//     equal strings were two objects with two cursors; now they are one
//     object with one, and two loops scanning it in opposite directions
//     share that cursor. Wrong indices here would be silent.
//   * The in-place append arm, whose sole gate is rc == 1. An interned
//     string is held by the table, so it can never be seen at rc == 1 —
//     which is the entire reason interning cannot corrupt a value. If that
//     ever stops holding, `base` changes under a `s += x` on an alias, and
//     that is the failure this file is really watching for.
//
// Lengths are chosen around the band: 15 is below it, 16 and 128 are its
// edges, 129 is above, and the multi-byte cases separate BYTE length (what
// the band is measured in) from `.length` (UTF-16 units).

function seg(n: number, tag: string): string {
  // Distinct content per (n, tag), built by += so every intermediate is a
  // concat result and the whole prefix chain walks through the band.
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + ((i * 7 + tag.charCodeAt(0)) % 26));
  return s;
}

function digest(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

const BAND = [15, 16, 17, 29, 63, 64, 100, 127, 128, 129];

// ── 1. two independent constructions of the same bytes ────────────────────
// `left + right` and a += loop reach the same content by different routes,
// so a hit and a miss both happen for every length.
for (const n of BAND) {
  const viaLoop = seg(n, "a");
  const viaLoop2 = seg(n, "a");
  const half = Math.floor(n / 2);
  const viaHalves = seg(half, "a") + seg(n, "a").slice(half);
  const viaTemplate = `${seg(half, "a")}${seg(n, "a").slice(half)}`;
  console.log(
    "same", n,
    viaLoop === viaLoop2, viaLoop === viaHalves, viaLoop === viaTemplate,
    Object.is(viaLoop, viaHalves), viaLoop == viaHalves,
    viaLoop.length, digest(viaLoop), digest(viaHalves), digest(viaTemplate),
    viaLoop < seg(n, "b"), viaLoop.localeCompare(viaLoop2),
  );
}

// ── 2. symbols over shared descriptions ───────────────────────────────────
for (const n of [16, 64, 128]) {
  const d1 = seg(n, "s");
  const d2 = seg(Math.floor(n / 2), "s") + seg(n, "s").slice(Math.floor(n / 2));
  const s1: symbol = Symbol(d1);
  const s2: symbol = Symbol(d2);
  console.log("sym", n, d1 === d2, s1 === s2, s1.description === d2,
              s1.toString() === s2.toString(), s1.toString().length);
  const f1: symbol = Symbol.for(d1);
  const f2: symbol = Symbol.for(d2);
  console.log("symfor", n, f1 === f2, Symbol.keyFor(f1) === d2,
              (Symbol.keyFor(f1) ?? "").length);
}

// ── 3. keys: Map, Set, object properties, Object.keys, JSON ───────────────
{
  const m = new Map<string, number>();
  const st = new Set<string>();
  const obj: Record<string, number> = {};
  for (const n of BAND) {
    const k1 = seg(n, "k");
    const k2 = seg(Math.floor(n / 2), "k") + seg(n, "k").slice(Math.floor(n / 2));
    m.set(k1, n);
    m.set(k2, n * 2); // same key by value: an overwrite, never a second entry
    st.add(k1);
    st.add(k2);
    obj[k1] = n;
    obj[k2] = n * 3;
  }
  console.log("map size", m.size, "set size", st.size, "obj keys", Object.keys(obj).length);
  for (const n of BAND) {
    const k = seg(n, "k");
    console.log("key", n, m.get(k), st.has(k), obj[k], k in obj,
                Object.prototype.hasOwnProperty.call(obj, k));
  }
  // Insertion order must survive: a shared key is still the FIRST insertion's
  // position, exactly as an unshared one is.
  const keys = Object.keys(obj);
  console.log("key order", keys.map((k) => k.length).join(","));
  const text = JSON.stringify(obj);
  const back = JSON.parse(text) as Record<string, number>;
  const backKeys = Object.keys(back);
  console.log("json", text.length, backKeys.length,
              backKeys.map((k) => k.length).join(","),
              backKeys.every((k) => back[k] === obj[k]));
}

// ── 4. the UTF-16 index cache, shared between aliases ─────────────────────
// Two names for one object, scanned in opposite directions, interleaved. The
// cache holds ONE cursor for the object; if a backward scan leaves it in a
// state the forward scan trusts, the indices come back wrong.
for (const n of [64, 128]) {
  const a = seg(n, "u");
  const b = seg(Math.floor(n / 2), "u") + seg(n, "u").slice(Math.floor(n / 2));
  let f = 0;
  let g = 0;
  for (let i = 0; i < n; i++) {
    f = (f * 31 + a.charCodeAt(i)) & 0x7fffffff;
    g = (g * 31 + b.charCodeAt(n - 1 - i)) & 0x7fffffff;
  }
  console.log("cursor", n, a === b, f, g, a.charAt(0), a.charAt(n - 1),
              a.indexOf(a.slice(n - 3)), b.lastIndexOf(b.slice(0, 3)));
}

// ── 5. mutation adjacency: an alias must never move under an append ───────
// `s += x` compiles to concat + release. When `s` is the sole reference the
// runtime appends IN PLACE. A shared block must refuse that, and this is the
// shape that would print the corruption if it ever did not.
for (const n of [16, 29, 64, 127]) {
  const base = seg(n, "m");
  const alias = seg(Math.floor(n / 2), "m") + seg(n, "m").slice(Math.floor(n / 2));
  let s = alias;
  for (let i = 0; i < 5; i++) s += "!";
  console.log("append", n, base === alias, base.length, alias.length, s.length,
              digest(base), digest(alias), base === alias, s.slice(-5),
              digest(s));
  // ...and the reverse order: grow first, then check the original again.
  let t = base;
  t = t + "?" + t;
  console.log("append2", n, base.length, t.length, digest(base), digest(t),
              t.slice(0, n) === base, t.slice(n + 1) === base);
}

// ── 6. slice, concat, repeat, pad, and Buffer round trips ─────────────────
for (const n of [16, 64, 128]) {
  const a = seg(n, "p");
  const b = seg(Math.floor(n / 2), "p") + seg(n, "p").slice(Math.floor(n / 2));
  const buf = Buffer.from(a, "utf8");
  console.log("shape", n, a === b,
              a.slice(0, 8) === b.slice(0, 8),
              (a + "z") === (b + "z"),
              a.repeat(2).length, "".padEnd(n, a).length,
              a.toUpperCase() === b.toUpperCase(),
              buf.length, buf.toString("utf8") === b,
              Buffer.from(b, "utf8").equals(buf),
              buf.toString("base64").length);
}

// ── 7. multi-byte: the band is measured in BYTES, `.length` is not ────────
// A 60-character accented string is 120 bytes and is inside the band; a
// 70-character one is 140 bytes and is outside it. Neither fact is visible
// from JS, and both must answer the same.
function acc(n: number, tag: string): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(0x00e0 + ((i + tag.charCodeAt(0)) % 24));
  return s;
}
for (const n of [8, 30, 60, 64, 70, 100]) {
  const a = acc(n, "x");
  const b = acc(Math.floor(n / 2), "x") + acc(n, "x").slice(Math.floor(n / 2));
  console.log("wide", n, a === b, a.length, b.length,
              Buffer.byteLength(a, "utf8"), digest(a), digest(b),
              a.charCodeAt(0), a.charCodeAt(n - 1), a.slice(2, 5) === b.slice(2, 5),
              JSON.stringify(a) === JSON.stringify(b));
}

// ── 8. churn: the table is a fixed size and evicts; a value must not ──────
// Far more distinct contents than any table holds, built twice, checked
// against a plain array. What is being checked is that eviction, admission
// and re-insertion cannot change a byte — a program cannot see the table's
// size, so the answers must not depend on it.
{
  const want: string[] = [];
  for (let i = 0; i < 600; i++) want.push(seg(20 + (i % 90), "c" + String(i % 7)) + ":" + i);
  let acc2 = 0;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 600; i++) {
      const again = seg(20 + (i % 90), "c" + String(i % 7)) + ":" + i;
      if (again !== want[i]) console.log("CHURN MISMATCH", round, i);
      acc2 = (acc2 + digest(again) + again.length) & 0x7fffffff;
    }
  }
  console.log("churn", acc2, want.length, want[0].length, want[599].length);
}
