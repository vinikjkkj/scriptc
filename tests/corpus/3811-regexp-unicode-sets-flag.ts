// The regex 'v' flag (unicodeSets), literal and constructor.
//
// libregexp has carried LRE_FLAG_UNICODE_SETS all along -- scr_regex.c already
// reads it in three places (`unicode` is `UNICODE | UNICODE_SETS` in exec,
// matchAll and split) -- but nothing could ever SET it: scr_lre_flags had no
// 'v' case and trapped as an internal error, scr_regex_new's accept-list left
// 'v' out, and the frontend fenced a `/…/v` literal with SC1120.
//
// The two halves failed differently, and only one of them was loud:
//
//   - a LITERAL `/…/v` was an SC1120 build error, which is a fence;
//   - `new RegExp(p, "v")` COMPILED and threw a runtime SyntaxError,
//     "Invalid flags supplied to RegExp constructor 'v'", on a program Node
//     runs to completion. No census can see that: it is not an [SCxxxx]
//     site in the emitted C, it is the regex runtime refusing a flag the
//     engine underneath it supports.
//
// 'v' is not merely 'u' with another name. Its own syntax -- nested classes,
// the set operations `--` (difference) and `&&` (intersection), and `\q{}`
// string literals -- is what r02/r05/r06 exercise, and libregexp compiles all
// of it. Passing LRE_FLAG_UNICODE_SETS is the whole lowering: 'v' implies
// unicode, so the CESU-8 re-encode a non-unicode pattern needs (an astral
// character spelled as two surrogate units) must NOT run for it, which is
// r07's astral row on both the eager constructor path and the lazy literal
// one.
//
// scr_regex_new's flag validation is Node's, in one pass and with Node's one
// message for all three failures: an unsupported letter, a REPEATED letter
// (r09 -- previously accepted, since the old accept-list never looked back),
// and 'u' with 'v' together (r08), which the spec makes mutually exclusive.
//
// Still fenced deliberately, so it cannot be a row here: the 'd' flag (match
// indices), which needs the whole `.indices` surface rather than a flag bit.

// ------------------------------------------------ 1. the LITERAL spelling
const setops = /[[a-z]--[aeiou]]/v;
console.log("r01", setops.test("q"), setops.test("a"));
console.log("r02", setops.flags, setops.source);

// `&&` intersection, and a nested class.
const both = /[[a-z]&&[a-f]]/v;
console.log("r03", both.test("c"), both.test("z"));

// ------------------------------------------- 2. the CONSTRUCTOR spelling
// This is the half that COMPILED on the base compiler and threw at runtime.
const ctor = new RegExp("[[a-z]--[aeiou]]", "v");
console.log("r04", ctor.test("q"), ctor.test("a"), ctor.flags);

const combined = new RegExp("x", "gv");
console.log("r05", combined.flags, combined.source);

const plain = new RegExp("[a-c]", "v");
console.log("r06", plain.test("b"), plain.test("z"));

// ------------------------------------------------- 3. \q{} string literals
console.log("r07", /[\q{abc|d}]/v.test("abc"), /[\q{abc|d}]/v.test("d"), /[\q{abc|d}]/v.test("z"));

// -------------------------------------------------------- 4. astral input
// 'v' implies unicode, so the pattern must NOT be re-encoded as CESU-8 --
// once on the lazy literal path and once on the eager constructor one.
console.log("r08", /[\u{1F600}-\u{1F64F}]/v.test("\u{1F600}"), /[\u{1F600}-\u{1F64F}]/v.test("a"));
console.log("r09", new RegExp("[\u{1F600}-\u{1F64F}]", "v").test("\u{1F60A}"));

// ------------------------------------------------------- 5. string methods
console.log("r10", "axbxc".replace(/x/v, "-"));
console.log("r11", "axbxc".replaceAll(/x/gv, "-"));
console.log("r12", "a1b22c".split(/[[0-9]--[3-9]]+/v).join("|"));
console.log("r13", "hello world".match(/[[a-z]--[aeiou]]/v)?.[0]);

// ---------------------------------------------------- 6. flag VALIDATION
// Node's three rejections, all carrying Node's single message.
try { new RegExp("a", "uv"); console.log("r14 NOT REJECTED"); }
catch (e) { console.log("r14", (e as Error).name, (e as Error).message); }
try { new RegExp("a", "vv"); console.log("r15 NOT REJECTED"); }
catch (e) { console.log("r15", (e as Error).name, (e as Error).message); }
try { new RegExp("a", "gg"); console.log("r16 NOT REJECTED"); }
catch (e) { console.log("r16", (e as Error).name, (e as Error).message); }

// A pattern that is invalid UNDER 'v' specifically: an unescaped set-operation
// reserved punctuator. The engine reports it, and the error is catchable.
try { new RegExp("[a(b]", "v"); console.log("r17 NOT REJECTED"); }
catch (e) { console.log("r17", (e as Error).name); }

// ------------------------------- 7. the FUNCTION-REPLACER path, un-fenced
// lowerStringReplaceWithFn fences a function replacement value over a regex
// carrying a flag outside the lowered alphabet -- and 'v' was outside it, so
// widening the alphabet un-fences this path too. That is a behaviour change
// this file has to own rather than leave to the diagnostics snapshot that
// used to pin it (tests/diagnostics/regex-replacer.ts).
console.log("r18", "abc".replace(new RegExp("(a)", "v"), (m: string, g: string): string => g + g));
console.log("r19", "abcabc".replace(new RegExp("(b)", "gv"), (m: string, g: string): string => "[" + g + "]"));
console.log("r20", "xayb".replace(/([[a-z]--[aeiou]])/gv, (m: string, g: string): string => g.toUpperCase()));
console.log("r21", "aaa".replaceAll(/(a)/gv, (m: string, g: string): string => g + "!"));
