// `new RegExp(p, "v")` — the half of the 'v' flag that COMPILED and was
// wrong at RUNTIME.
//
// 3811 covers the flag itself. This file exists because the two halves of the
// same gap failed differently, and only one of them was a fence:
//
//   - `/[[a-z]--[aeiou]]/v` was an SC1120 BUILD ERROR. Loud. A census sees it,
//     a `--best-effort` build turns it into an [SCxxxx] trap site, and no
//     program shipped with it.
//   - `new RegExp(p, "v")` had no literal for the frontend to look at. It
//     compiled clean, produced no trap site, and threw
//     `SyntaxError: Invalid flags supplied to RegExp constructor 'v'` the
//     first time the constructor ran — on a program Node runs to completion.
//
// So this file deliberately contains NO regex literal carrying 'v': every
// occurrence is a constructor, and the flag string is read out of a binding so
// no constant fold can turn it back into a literal. On the base compiler it
// BUILDS and throws at the first line; the divergence is a runtime one and a
// trap census cannot see it. That is the only reason it is a separate file.

const V = "v";
const GV = "g" + V;

const a = new RegExp("[[a-z]--[aeiou]]", V);
console.log("r01", a.test("q"), a.test("a"), a.flags);

const b = new RegExp("[a-c]", V);
console.log("r02", b.test("b"), b.test("z"));

const c = new RegExp("x", GV);
console.log("r03", c.flags, c.source);
console.log("r04", "axbxc".replaceAll(c, "-"));

// The engine's own view of the pattern must be the unicode one: 'v' implies
// unicode, so an astral range matches a whole code point rather than a
// surrogate half.
const d = new RegExp("[\u{1F600}-\u{1F64F}]", V);
console.log("r05", d.test("\u{1F60A}"), d.test("a"));

// \q{} string literals, reachable only under 'v'.
const e = new RegExp("^[\\q{abc|d}]$", V);
console.log("r06", e.test("abc"), e.test("d"), e.test("ab"));

// A flags string built at runtime that is INVALID: the same message Node
// gives, thrown as a catchable SyntaxError rather than a fence.
for (const bad of ["uv", "vv", "vq"]) {
  try {
    new RegExp("a", bad);
    console.log("r07", bad, "NOT REJECTED");
  } catch (err) {
    console.log("r07", bad, (err as Error).name, (err as Error).message);
  }
}
