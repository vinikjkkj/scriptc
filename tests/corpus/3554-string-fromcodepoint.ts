// `String.fromCodePoint(...points)` — the spec's validation plus
// UTF16Encode, in IR, over the encoder `String.fromCharCode` was already
// calling.
//
// zapo's spelling is `message/addons/link-preview/fetcher.ts:200` —
// `safeCodePoint(cp)`, the HTML numeric-entity decoder behind
// `&#NNN;` / `&#xHH;` in a fetched page's <title>. It reported SC2020.
//
// No new runtime unit exists for this. `scr_str_from_units` — the one
// `fromCharCode` already calls — combines an adjacent surrogate pair back
// into its code point and UTF-8 encodes it. What this rule adds is the
// part that was genuinely missing: the RangeError, and the surrogate
// arithmetic that decides which units to emit.
//
// The helper takes the WHOLE argument list and makes ONE `fromCharCode`
// call over every unit it produced. That is not a tidiness choice, and
// the rows under "ADJACENT SURROGATE ARGUMENTS" below are why. The first
// version of this rule encoded each argument on its own and concatenated
// the strings; it shipped, and it was WRONG for one input shape:
// `String.fromCodePoint(0xD83D, 0xDE00)` is U+1F600 in Node, because
// fromCodePoint appends UTF-16 CODE UNITS and two adjacent lone
// surrogates form a real pair. A per-argument encoder hands
// `scr_str_from_units` a one-unit array per argument, where the pairing
// lookahead has nothing to look ahead at, so each surrogate separately
// met divergence 1's storage policy and the answer was two U+FFFD
// (`efbfbdefbfbd` instead of `f09f9880`). Those rows are the regression
// guard; they are spelled in BYTES because that is the only reading that
// distinguishes the two answers.
//
// The three refusals are the spec's, and the exceptional Numbers each land
// on the intended side: NaN and Infinity fail the range comparisons (which
// are spelled as strict complements so NaN's always-false comparisons throw
// rather than pass), while -0 does NOT throw — `-0 % 1` is `-0` and
// `-0 !== 0` is false, so it encodes U+0000, exactly as Node does.

function show(cp: number): void {
    try {
        const s = String.fromCodePoint(cp);
        console.log(cp, JSON.stringify(s), s.length);
    } catch (e) {
        console.log(cp, "THROW", (e as Error).message, e instanceof RangeError);
    }
}

// Every UTF-8 width boundary, and both ends of the astral plane.
for (const v of [0, 1, 65, 0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x1f600, 0x10ffff]) show(v);

// The refusals, including the three Numbers that need the guard spelled
// carefully. `-0` is in this list because it is the one that must NOT throw.
for (const v of [-1, 1.5, -0.5, 0x110000, NaN, Infinity, -Infinity, -0]) show(v);

// No arguments is the empty string, not a fence.
console.log(JSON.stringify(String.fromCodePoint()));

// Several arguments concatenate left to right, mixing BMP and astral.
console.log(JSON.stringify(String.fromCodePoint(72, 0x1f600, 105)));
console.log(String.fromCodePoint(65, 66, 0x1f600).length);

// ORDER. The spec validates and appends one code point at a time, so a bad
// argument throws after the good ones would have been appended — and since
// nothing observes the partial string, what is visible is only that the
// throw happens and names the offending value.
try {
    console.log(String.fromCodePoint(65, -1));
} catch (e) {
    console.log("order", (e as Error).message);
}

// Through a function boundary and a real decode, zapo's own shape: the
// guard in front means the RangeError branch never runs here, which is
// exactly why the site is worth compiling rather than trapping.
function safeCodePoint(cp: number): string {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
    return String.fromCodePoint(cp);
}
for (const n of [233, 0x1f600, 65, 0x110000, -5, 0]) {
    console.log(n, JSON.stringify(safeCodePoint(n)));
}

// A round trip through the UTF-16 units the string actually stores: a BMP
// code point is one unit, an astral one is the surrogate pair the encoder
// produced.
for (const v of [0x41, 0x800, 0xffff, 0x10000, 0x1f600, 0x10ffff]) {
    const s = String.fromCodePoint(v);
    const units: number[] = [];
    for (let i = 0; i < s.length; i += 1) units.push(s.charCodeAt(i));
    console.log(v, s.length, units.join(":"));
}

// ADJACENT SURROGATE ARGUMENTS — the rows that caught a live wrong answer.
//
// A lone surrogate that stays lone is `"\ud800"` in Node and U+FFFD here:
// the pre-existing storage policy of scriptc's UTF-8 strings
// (scr_str_from_units, "divergence 1"), reachable identically through
// `String.fromCharCode(0xD800)` since long before this rule. That part is
// inherited, so it is pinned in BYTES (where the two agree, `efbfbd`)
// rather than through JSON.stringify (where they cannot).
//
// A surrogate that PAIRS with its neighbour is a different matter: there
// is no divergence at all, Node and scriptc must both answer the astral
// character, and getting it wrong is a silent mis-encode of real text.
function hex(s: string): string {
    return Buffer.from(s, "utf8").toString("hex");
}
console.log("pair-as-two  ", hex(String.fromCodePoint(0xd83d, 0xde00)));
console.log("astral-direct", hex(String.fromCodePoint(0x1f600)));
console.log("pair==astral ", hex(String.fromCodePoint(0xd83d, 0xde00)) === hex(String.fromCodePoint(0x1f600)));
console.log("embedded-pair", hex(String.fromCodePoint(65, 0xd83d, 0xde00, 66)));
console.log("lone-hi      ", hex(String.fromCodePoint(0xd800)));
console.log("lone-lo      ", hex(String.fromCodePoint(0xdfff)));
console.log("lone-hi-then-A", hex(String.fromCodePoint(0xd800, 65)));
console.log("lo-then-hi   ", hex(String.fromCodePoint(0xdc00, 0xd800)));
// An astral argument's own low surrogate must not steal the next
// argument, and a lone high surrogate must not steal an astral one's.
console.log("astral+lone  ", hex(String.fromCodePoint(0x1f600, 0xdc00)));
console.log("lone+astral  ", hex(String.fromCodePoint(0xd83d, 0x1f600)));

// THE SPREAD FORM. It lowers because the helper already takes the whole
// list: a spread is the f64[] it wants. Same answers as the fixed form,
// including the pairing.
const pts = [72, 101, 0x1f600, 33];
console.log("spread       ", hex(String.fromCodePoint(...pts)));
console.log("spread-pair  ", hex(String.fromCodePoint(...[0xd83d, 0xde00])));
console.log("spread-empty ", JSON.stringify(String.fromCodePoint(...([] as number[]))));
// A spread whose contents are only known at run time still validates.
function pointsFor(which: string): number[] {
    return which === "bad" ? [65, 0x110000] : [65, 66];
}
for (const w of ["good", "bad"]) {
    try {
        console.log("spread-" + w, hex(String.fromCodePoint(...pointsFor(w))));
    } catch (e) {
        console.log("spread-" + w, "THROW", (e as Error).message, e instanceof RangeError);
    }
}
