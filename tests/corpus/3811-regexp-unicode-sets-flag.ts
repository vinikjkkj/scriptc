// The 'v' flag on a regex LITERAL — the half 3801 cannot reach.
//
// 3801 owns `new RegExp(pattern, flags)`: it validates the whole flag string,
// accepts 'v', rejects a repeat and 'u'+'v', and stores the flags in getter
// order. This file owns the other place a flag string is born, and the two
// were fixed from opposite ends:
//
//   * scr_regex_new is the RUNTIME gate. 3801 covers it exhaustively.
//   * lowerRegexLiteral is the COMPILE-TIME gate, and it fenced `/…/v` with
//     SC1120 no matter what the runtime could do. So on a compiler with
//     3801's fix and not this one, every row below is a BUILD ERROR while
//     node runs the program — which is why 3801 contains no `v` literal
//     anywhere and could not have.
//
// Three things here are literal-only and no constructor row can substitute:
//
//   1. The LAZY compile path. A literal compiles at first use through
//      scr_regex_bc, a constructor eagerly through scr_regex_new, and the
//      CESU-8 re-encode is a separate guard in each. r08/r09 drive the lazy
//      one with an astral pattern: 'v' is a unicode-mode grammar exactly as
//      'u' is, so re-encoding under it would split each code point into two
//      lone surrogates.
//   2. The frontend's getter-order normalisation MEETING 'v'. Both gates
//      normalise, but only literals can be written out of order in source,
//      and until 'v' was in the alphabet no out-of-order string could
//      contain it. r02/r03 are `/a/vg` and `/a/yvsmig`.
//   3. The FUNCTION-REPLACER path. lowerStringReplaceWithFn refuses a
//      function replacement value over a regex carrying a flag outside the
//      lowered alphabet, so widening the alphabet un-fenced it as a side
//      effect. That is a behaviour change and r14-r17 own it rather than
//      leaving it to the diagnostics snapshot that used to pin it
//      (tests/diagnostics/regex-replacer.ts).
//
// Deliberately absent, so this file stays a byte-for-byte differential:
// the 'd' flag. Node builds the regex; scriptc refuses it at BOTH gates
// (SC1120 on a literal, SyntaxError from the constructor). 3801's header
// records the same exclusion for the same reason.

// ------------------------------------------------ 1. the LITERAL, and .flags
const setops = /[[a-z]--[aeiou]]/v;
console.log("r01", setops.test("q"), setops.test("a"), setops.flags, setops.source);

// Getter order (dgimsuvy) with 'v' in it — source order is never the answer.
console.log("r02", /a/vg.flags, /a/gv.flags);
console.log("r03", /a/yvsmig.flags, /a/gimsvy.flags);

// `&&` intersection and a nested class.
const both = /[[a-z]&&[a-f]]/v;
console.log("r04", both.test("c"), both.test("z"), both.flags);

// ------------------------------------------- 2. the two gates must AGREE
// The same pattern and the same flags through the literal gate and the
// constructor gate: same source, same flags string, same answer. This is the
// cross-check between lowerRegexLiteral's normalisation and scr_regex_new's.
const litGv = /[[a-z]--[aeiou]]/vg;
const ctorGv = new RegExp("[[a-z]--[aeiou]]", "vg");
console.log("r05", litGv.flags === ctorGv.flags, litGv.source === ctorGv.source, litGv.flags);
console.log("r06", "abcdez".replace(litGv, "."), "abcdez".replace(ctorGv, "."));

// ------------------------------------------------ 3. \q{} string literals
console.log("r07", /^[\q{abc|d}]$/v.test("abc"), /^[\q{abc|d}]$/v.test("d"), /^[\q{abc|d}]$/v.test("z"));

// ------------------------------ 4. astral input through the LAZY compile
// The literal path compiles on first use; the CESU-8 guard there is its own.
console.log("r08", /[\u{1F600}-\u{1F64F}]/v.test("\u{1F600}"), /[\u{1F600}-\u{1F64F}]/v.test("a"));
console.log("r09", /\u{1F600}/v.test("\u{1F600}"), /\u{1F600}/u.test("\u{1F600}"));

// ---------------------------------------------- 5. the string methods
console.log("r10", "axbxc".replace(/x/v, "-"));
console.log("r11", "axbxc".replaceAll(/x/gv, "-"));
console.log("r12", "a1b22c".split(/[[0-9]--[3-9]]+/v).join("|"));
console.log("r13", "hello world".match(/[[a-z]--[aeiou]]/v)?.[0]);

// ------------------------------------- 6. the un-fenced FUNCTION replacer
console.log("r14", "abc".replace(new RegExp("(a)", "v"), (m: string, g: string): string => g + g));
console.log("r15", "abcabc".replace(new RegExp("(b)", "gv"), (m: string, g: string): string => "[" + g + "]"));
console.log("r16", "xayb".replace(/([[a-z]--[aeiou]])/gv, (m: string, g: string): string => g.toUpperCase()));
console.log("r17", "aaa".replaceAll(/(a)/gv, (m: string, g: string): string => g + "!"));

// ------------------------------------ 7. a plain pattern under /v still works
const plain = /[a-c]/v;
console.log("r18", plain.test("b"), plain.test("z"), plain.flags);
