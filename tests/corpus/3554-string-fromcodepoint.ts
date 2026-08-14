// `String.fromCodePoint(cp)` — the spec's validation plus UTF16Encode, in
// IR, over the encoder `String.fromCharCode` was already calling.
//
// zapo's spelling is `message/addons/link-preview/fetcher.ts:200` —
// `safeCodePoint(cp)`, the HTML numeric-entity decoder behind
// `&#NNN;` / `&#xHH;` in a fetched page's <title>. It reported SC2020.
//
// No new runtime unit exists for this. `scr_str_from_units` — the one
// `fromCharCode` already calls — combines an adjacent surrogate pair back
// into its code point and UTF-8 encodes it, so the second branch of the
// encoder is a two-unit `fromCharCode` and nothing more. What this rule
// adds is the part that was genuinely missing: the RangeError, and the
// surrogate arithmetic that decides which call to make.
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

// NOT asserted here, and deliberately: a LONE surrogate
// (`String.fromCodePoint(0xD800)`) is `"\ud800"` in Node and U+FFFD here.
// That is the pre-existing storage policy of scriptc's UTF-8 strings
// (scr_str_from_units, "divergence 1"), reachable identically through
// `String.fromCharCode(0xD800)` since long before this rule — it is
// inherited, not introduced, so this fixture does not pin it.
