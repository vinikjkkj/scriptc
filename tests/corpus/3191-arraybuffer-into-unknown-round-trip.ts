// An ArrayBuffer crossing into `unknown` and back — the SCR_DYN_ARRBUF
// box, one of the two kinds zapo's twenty SC1101 sites actually fence on.
//
// The interesting thing about this kind is what it must NOT answer. An
// ArrayBuffer shares its whole runtime representation with a Uint8Array
// (one refcounted ScrBytes, so a view over it aliases either side of the
// boundary), and it would have been very natural to carry it as the
// existing bytes kind with an element tag. Everything below is a question
// where that would have produced a confident wrong answer instead of a
// fence: `length` is undefined and not 4, an index is undefined and not a
// byte, String() is "[object ArrayBuffer]" and not "1,2,3,4", JSON is {}
// and not the index-keyed object, and `instanceof Uint8Array` is false.
//
// crypto.hkdfSync is the producer, because it is the one lowering that
// hands back a free-standing ArrayBuffer value (`.buffer` is admitted only
// inline, inside new DataView(...) / Buffer.from(...)).
import { hkdfSync } from "node:crypto";
import { inspect } from "node:util";

const salt = new Uint8Array([1, 2]);
const info = new Uint8Array([3]);
const key = new Uint8Array([4]);
const buf = hkdfSync("sha256", key, salt, info, 8);

// Widening: the payload is SHARED, not copied.
const u: unknown = buf;

// The two answers no layout is needed for.
console.log(typeof u);
console.log(u ? "truthy" : "falsy");

// ToString, both spellings — an ArrayBuffer has no own toString, so both
// are Object.prototype.toString's tagged form. (The emitted per-program
// ToString walker is a COPY of the runtime's table; before this kind it
// had no default arm at all, so a kind it did not know about appended
// nothing and String(u) answered the empty string. Both spellings are
// printed here because they reach the copy and the original by different
// routes.)
console.log(String(u));
console.log(`${u}`);

// No own enumerable properties, so JSON.stringify writes {} — NOT the
// index-keyed form a typed array gets.
console.log(JSON.stringify(u));

// Node's real inspect form, brackets and all.
console.log(inspect(u));

// Narrowing hands back the SAME buffer: identity survives, which is the
// whole reason to carry an ArrayBuffer rather than copy one.
const back = u as ArrayBuffer;
console.log(back === buf);
console.log(back.byteLength);

// Two independent crossings of one buffer are one JS value.
const again: unknown = buf;
console.log((again as ArrayBuffer) === back);

// An ArrayBuffer is not a typed array, and the dyn tree must agree with
// the static world about that.
console.log(u instanceof Uint8Array);

// A DIFFERENT buffer with the same bytes is a different value under ===.
const other = hkdfSync("sha256", key, salt, info, 8);
console.log((u as ArrayBuffer) === other);

// ── the dynMatch arm, exercised rather than argued ────────────────────
//
// Narrowing an `unknown` back to a UNION carrying BOTH bytes arms is the
// one place the two kinds' separation is load-bearing at runtime rather
// than in a comment. dynMatch tests the KIND only:
//
//     return d->kind == SCR_DYN_BYTES;      // the u8 arm
//     return d->kind == SCR_DYN_ARRBUF;     // the buf arm
//
// With one shared kind and an element tag, both arms would have compiled
// to the SAME test, the first matching arm would have won for every bytes
// value, and the union would have carried the wrong tag into every later
// read — a wrong answer, not a fence, and one nothing else here would
// notice. Two kinds make the obvious test the correct one.
type Bin = Uint8Array | ArrayBuffer | string;

function which(v: unknown): string {
  const b = v as Bin;
  if (typeof b === "string") return "string";
  if (b instanceof Uint8Array) return `u8:${b.length}`;
  return `buf:${(b as ArrayBuffer).byteLength}`;
}

console.log(which(buf as unknown));
console.log(which(new Uint8Array([7, 8, 9]) as unknown));
console.log(which("hi" as unknown));
