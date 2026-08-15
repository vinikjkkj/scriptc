// new RegExp(pattern, flags): the FLAG STRING, and what it is allowed to
// say. Three separate things were wrong here and only one of them was the
// one anybody was looking for; the other two came out of comparing the
// whole table against node v25.9.0 instead of the one case in the brief.
//
//   'v' (unicodeSets)   threw "Invalid flags supplied ..." where node
//                       builds the regex. It is LRE_FLAG_UNICODE_SETS,
//                       which the vendored libregexp already implements
//                       and which scr_regex.c already read in three
//                       places beside LRE_FLAG_UNICODE — only the two
//                       flag gates and the two CESU-8 guards had never
//                       heard of it.
//   a REPEATED letter   new RegExp("a", "gg") was ACCEPTED. Node throws.
//   the flags ORDER     `flags` is a getter and JS answers it in getter
//                       order (dgimsuvy), never source order: node says
//                       new RegExp("a","yg").flags === "gy" and inspects
//                       /x/ysmig as /x/gimsy. Both spellings echoed the
//                       source order back — literals included, which is
//                       the common path and had never been compared.
//
// Two things this file deliberately does NOT contain, because a corpus
// program is a byte-for-byte differential against node and these two are
// known divergences that would make it a lie:
//
//   * the 'd' (hasIndices) flag. Node builds the regex; scriptc refuses
//     it with the SyntaxError above. There is no LRE flag for it and a
//     match result here carries no `indices`, so admitting the letter
//     would answer wrongly rather than refuse. Taking 'd' means taking
//     the whole `indices` surface, and it is the one letter where this
//     runtime's "Invalid flags supplied" text is not node's answer.
//   * the DETAIL text of an invalid-pattern SyntaxError ("Range out of
//     order in character class" vs libregexp's "invalid class range").
//     scr_regex.c documents that divergence: e.name is exact, the detail
//     is libregexp's. So pattern failures below print the NAME only,
//     while flag failures print the whole message — that message is
//     scriptc's own and is exact.
//
// `.match()` on a /g or /y regex is a separate documented refusal (an
// every-match array is a different shape), so the global arms here use
// `replace`, not `match`.

function flagCase(f: string): void {
  let out = "";
  try {
    const re = new RegExp("[a-c]", f);
    out = "OK source=" + re.source + " flags=" + re.flags;
  } catch (e) {
    const err = e as Error;
    out = err.name + ": " + err.message;
  }
  let pad = JSON.stringify(f);
  while (pad.length < 12) pad = pad + " ";
  console.log(pad + out);
}

console.log("-- the accepted alphabet, one letter at a time --");
for (const f of ["", "g", "i", "m", "s", "u", "v", "y"]) flagCase(f);

console.log("-- 'v' with each of the others, and the getter order --");
for (const f of ["vg", "vi", "vm", "vs", "vy", "yv", "yg", "ysmig", "gimsvy"]) flagCase(f);

console.log("-- rejected: unknown, repeated, and u-with-v --");
for (const f of ["x", "gx", "V", "U", "gg", "vv", "gig", "uv", "vu", "gimsuvy"]) flagCase(f);

console.log("-- the message quotes the flags in FULL, not the first 20 --");
flagCase("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

console.log("-- v-mode set arithmetic (the point of the flag) --");
function vCase(label: string, pat: string, flags: string, subjects: string[]): void {
  let line = label + " ->";
  try {
    const re = new RegExp(pat, flags);
    line = line + " flags=" + re.flags + " source=" + re.source;
    for (const s of subjects) {
      const m = s.match(re);
      line = line + " [" + s + "=" + (m === null ? "-" : m[0]) + "]";
    }
  } catch (e) {
    // pattern failures: NAME only (see the header)
    line = line + " " + (e as Error).name;
  }
  console.log(line);
}
vCase("difference  ", "[[a-z]--[aeiou]]", "v", ["a", "b", "e", "z"]);
vCase("intersection", "[[a-m]&&[g-z]]", "v", ["a", "g", "m", "n"]);
vCase("union-nested", "[[a-c][x-z]]", "v", ["a", "m", "z"]);
vCase("complement  ", "[^[a-c]]", "v", ["a", "q"]);
vCase("prop-diff   ", "[\\p{ASCII}--[0-9]]", "v", ["7", "q"]);
vCase("prop-inter  ", "[\\p{ASCII}&&\\p{Letter}]", "v", ["7", "q"]);
vCase("q-strings   ", "[\\q{abc|d}]", "v", ["abc", "d", "a"]);
vCase("q-one-string", "[\\q{ab}]", "v", ["ab", "a"]);
vCase("q-punct     ", "[\\q{$}]", "v", ["$"]);
vCase("v-then-i    ", "[[a-z]--[aeiou]]", "vi", ["B", "E"]);
vCase("plain-under-v", "a+", "v", ["aab", "b"]);
vCase("bad-class   ", "[a-\\q{x}]", "v", ["a"]);

console.log("-- /v is a UNICODE grammar: an astral range is one code point --");
// The CESU-8 re-encoding that a non-unicode pattern needs would split
// each astral literal into two lone surrogates; both guards gate on the
// /u-or-/v pair, so /v sees the code point /u sees.
vCase("astral-v    ", "[\\u{1F600}-\\u{1F603}]", "v", ["\u{1F601}", "x"]);
vCase("astral-u    ", "[\\u{1F600}-\\u{1F603}]", "u", ["\u{1F601}", "x"]);

console.log("-- the global arms, through replace (match refuses /g) --");
console.log(new RegExp("[a-c]", "vg").flags, "abcz".replace(new RegExp("[a-c]", "vg"), "."));
console.log(new RegExp("[[a-z]--[aeiou]]", "vg").flags, "abcdez".replace(new RegExp("[[a-z]--[aeiou]]", "vg"), "."));

console.log("-- the LITERAL path reports getter order too --");
const lit = /x/ysmig;
console.log(lit.flags, lit.source);
console.log(lit);
const lit2 = /a/gi;
console.log(lit2.flags);
console.log(/b/uy.flags, /c/msi.flags, /d/gimsuy.flags);

console.log("-- a repeat is an error, a re-ordering is not: same regex --");
const r1 = new RegExp("[a-c]", "gi");
const r2 = new RegExp("[a-c]", "ig");
console.log(r1.flags === r2.flags, r1.flags, r2.flags);

console.log("ok");
