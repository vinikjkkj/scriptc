// `(u as Record<string, unknown>).k` where `u`'s VALUE is a union — the
// "retype without reshape" cast, read with a DOT rather than a bracket.
//
// This was an internal compiler error: SC9001, "recordKeyGet receiver:
// expected record, got union". The cast's index signature made the read an
// OVERFLOW read, and the overflow read was emitted against a receiver that
// had never been reshaped, so the IR named a record shape its own operand
// did not have. The BRACKET spelling has had the guard for this since the
// `Object.keys(o)` iteration idiom needed it; the dot spelling is the same
// read and never grew one.
//
// It is pinned here because of how it surfaced. Nothing in the corpus
// reached it, and zapo did not either — until a wide media union became
// dyn-convertible, at which point zapo's
//
//     throw new Error(`unsupported media message type: ${
//       String((content as Record<string, unknown>).type)}`)
//
// stopped being shadowed by an earlier fence and aborted the entire build.
// An ICE is the one answer worse than a trap: a trap costs one code path,
// a crash costs the 133 MB of C that every other path would have compiled
// to. The two spellings now share the rule — read it in the checked-dynamic
// tree when the value can cross, fence by name when it cannot.
type A = { readonly kind: "a"; readonly n: number };
type B = { readonly kind: "b"; readonly s: string };
type C = A | B;

// The dot spelling — the one that used to crash the compiler.
function tag(c: C): string {
  return String((c as Record<string, unknown>).kind);
}

// The bracket spelling — the same read, and the one that already worked.
// Both are here so the pair cannot drift apart again.
function tagBracket(c: C): string {
  return String((c as Record<string, unknown>)["kind"]);
}

// A key no arm declares: JS reads undefined through an index signature,
// and so does the dyn read the cast lowers to.
function missing(c: C): string {
  return String((c as Record<string, unknown>).nope);
}

const a: C = { kind: "a", n: 1 };
const b: C = { kind: "b", s: "x" };

console.log(tag(a), tag(b));
console.log(tagBracket(a), tagBracket(b));
console.log(missing(a), missing(b));
