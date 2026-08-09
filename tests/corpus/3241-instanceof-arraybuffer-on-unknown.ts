// `v instanceof ArrayBuffer` where v is `unknown` — the SIBLING test of
// `v instanceof Uint8Array`, and until now the only one of the pair the
// checked-dynamic tree could not answer.
//
// 3191 pins why the two flavors are two dyn KINDS: an ArrayBuffer shares
// its whole runtime representation with a Uint8Array, so carrying both as
// one kind with an element tag would have made every bytes question
// answer confidently and wrongly for one of them. SCR_DYN_ARRBUF exists
// so the obvious test is the correct one.
//
// But only the Uint8Array half of the pair had a lowering. `unknown
// instanceof ArrayBuffer` was SC1090 ("an 'unknown' operand needs a
// runtime flavor test the checked-dynamic tree does not carry yet: it
// tags bytes as one kind, and only Uint8Array reads that tag"), a refusal
// whose own text described a tree that no longer existed — the kind was
// there, the test was not.
//
// What makes the gap worth a fixture rather than a one-line lowering is
// WHERE the refusal landed. The idiom is a ladder:
//
//     if (data instanceof Uint8Array) return data
//     if (data instanceof ArrayBuffer) return toBytesView(data)
//
// and a ladder's second rung is only reached when the first said false.
// So a program could not observe the refusal by running: either the
// Uint8Array line answered true and the ArrayBuffer line was dead code,
// or it answered false and the program stopped there. The refusal was
// reachable only when it had nothing to say. Both rungs are exercised
// below, in both orders, over both flavors.
import { hkdfSync } from "node:crypto";

// hkdfSync is the one lowering that hands back a free-standing
// ArrayBuffer value, so it is how 3191 gets one and how this gets one.
const salt = new Uint8Array([1, 2]);
const info = new Uint8Array([3]);
const key = new Uint8Array([4]);
const buf = hkdfSync("sha256", key, salt, info, 8);
const u8 = new Uint8Array([10, 20, 30]);

// ── the pair, over both flavors ───────────────────────────────────────
const a: unknown = buf;
const b: unknown = u8;

console.log("buf isU8", a instanceof Uint8Array);
console.log("buf isAB", a instanceof ArrayBuffer);
console.log("u8  isU8", b instanceof Uint8Array);
console.log("u8  isAB", b instanceof ArrayBuffer);

// Neither test claims anything about the other kinds.
const s: unknown = "hi";
const n: unknown = 7;
const nul: unknown = null;
const arr: unknown = [1, 2, 3];
console.log("str isAB", s instanceof ArrayBuffer);
console.log("num isAB", n instanceof ArrayBuffer);
console.log("null isAB", nul instanceof ArrayBuffer);
console.log("arr isAB", arr instanceof ArrayBuffer);

// Negation, because the test is emitted through the same node.
console.log("buf notAB", !(a instanceof ArrayBuffer));

// ── the ladder, in the order every socket handler writes it ───────────
//
// The narrowed branch READS through the validated extraction
// (scr_dyn_arrbuf_unbox), which hands back the SAME payload rather than a
// copy — so identity survives the round trip and a view taken after the
// narrow still aliases the buffer that went in.
function normalize(data: unknown): string {
    if (data instanceof Uint8Array) {
        return "u8:" + String(data.length);
    }
    if (data instanceof ArrayBuffer) {
        return "ab:" + String(data.byteLength);
    }
    if (typeof data === "string") {
        return "str:" + String(data.length);
    }
    return "none";
}

console.log(normalize(buf as unknown));
console.log(normalize(u8 as unknown));
console.log(normalize("abcd" as unknown));
console.log(normalize(42 as unknown));

// The SAME ladder with the rungs swapped: an ArrayBuffer must not be
// caught by the Uint8Array rung when that rung comes second either.
function normalizeSwapped(data: unknown): string {
    if (data instanceof ArrayBuffer) {
        return "ab:" + String(data.byteLength);
    }
    if (data instanceof Uint8Array) {
        return "u8:" + String(data.length);
    }
    return "none";
}

console.log(normalizeSwapped(buf as unknown));
console.log(normalizeSwapped(u8 as unknown));

// Identity through the narrow: the payload is shared, not copied.
// (`===` between a narrowed dyn and a typed value is SC1100 like every
// other operator on an unknown — the narrow licenses READS, and identity
// goes through the cast 3191 uses. The point here is that the narrowed
// read and the cast agree, because both extract the same payload.)
const back: unknown = buf;
if (back instanceof ArrayBuffer) {
    const same = back as ArrayBuffer;
    console.log("same buffer", same === buf);
    console.log("byteLength", back.byteLength);
}

// A view built over the narrowed buffer sees the buffer's bytes — the
// relationship bytes<buf> exists for, now reachable from a dyn operand.
const widened: unknown = hkdfSync("sha256", key, salt, info, 4);
if (widened instanceof ArrayBuffer) {
    const view = new Uint8Array(widened);
    console.log("view length", view.length);
    console.log("view is u8", view instanceof Uint8Array);
}

// The test inside a boolean expression rather than an `if`, so the node
// is emitted in value position too.
const flags = [a, b, s, nul].map((v) => (v instanceof ArrayBuffer ? 1 : 0));
console.log("flags", flags.join(","));
