// `Object.hasOwn(o, k)` and `Object.prototype.hasOwnProperty.call(o, k)`
// over a PURE index-signature record (`Record<string, string>` — no
// declared fields at all).
//
//   error SC2020: 'Object.hasOwn' ... has no scriptc lowering yet
//   error SC1090: Function.prototype.call on a compiled function value
//
// Both fences were the same one: the record arm of Object.hasOwn answers
// from the DECLARED field list and carries the explicit-undefined-is-
// absent divergence, so index-signature shapes were excluded with it. A
// shape with no declared fields has no declared half to inherit that
// from — every key it holds lives in the overflow map, so membership IS
// the map's, exactly. The read that answers it already existed: a keyed
// get at the slot width (`V | undefined`) returns the undefined arm
// exactly when the map missed.
//
// zapo's spelling is the WebSocket header probe: `for (const key in
// headers)` (which lowered) plus the membership test (which did not),
// over a `Readonly<Record<string, string>>`.
//
// Three neighbouring shapes deliberately KEEP their fence, and a
// program is the wrong place to assert a refusal, so they are named
// here instead (each measured):
//   - a signature-free record through `.call` — that call site is
//     exactly where the declared-field divergence was judged
//     unacceptable, and making the two spellings agree is a separate
//     decision from lifting this fence;
//   - a MIXED shape (`{ a: string; [k: string]: string }`) — it has a
//     declared half, so it inherits the divergence;
//   - `Record<string, V | undefined>` and `unknown`-valued signatures
//     — there a stored explicit undefined and a miss are the same
//     value at this width, and JS answers true for the first;
//   - an ALREADY-UNION value (`Record<string, string | number>`) — the
//     widened read must surface the overflow value as one ARM of its
//     result, and widening a union by an undefined arm FLATTENS, so
//     `string | number` is not an arm of `string | number | undefined`.
//     (The first cut of this fix missed that and the EMITTER caught it,
//     loudly: `recordKeyGet ... the overflow value cannot surface as
//     the result type`. The gate is now the emitter's own requirement
//     spelled as a question rather than a guess.)

const headers: Readonly<Record<string, string>> = {
  "user-agent": "scriptc",
  origin: "https://example.test",
  "": "empty-key",
};

console.log("hasOwn present:", Object.hasOwn(headers, "origin"));
console.log("hasOwn absent:", Object.hasOwn(headers, "nope"));
console.log("hasOwn empty key:", Object.hasOwn(headers, ""));
// inherited members are NOT own
console.log("hasOwn toString:", Object.hasOwn(headers, "toString"));
console.log("hasOwn hasOwnProperty:", Object.hasOwn(headers, "hasOwnProperty"));
console.log("hasOwn __proto__:", Object.hasOwn(headers, "__proto__"));

// the `.call` spelling of the same question
console.log("call present:", Object.prototype.hasOwnProperty.call(headers, "user-agent"));
console.log("call absent:", Object.prototype.hasOwnProperty.call(headers, "x-nope"));

// the zapo shape, end to end
function countHeaders(h: Readonly<Record<string, string>> | undefined): number {
  let n = 0;
  if (h) {
    for (const key in h) {
      if (Object.prototype.hasOwnProperty.call(h, key)) n += 1;
    }
  }
  return n;
}
console.log("counted:", countHeaders(headers), countHeaders({}), countHeaders(undefined));

// a MUTABLE signature: inserts and deletes move the answer
const bag: Record<string, number> = { a: 1 };
console.log("bag a:", Object.hasOwn(bag, "a"), "b:", Object.hasOwn(bag, "b"));
bag["b"] = 2;
console.log("after insert b:", Object.hasOwn(bag, "b"), bag["b"]);
delete bag["a"];
console.log("after delete a:", Object.hasOwn(bag, "a"), "b still:", Object.hasOwn(bag, "b"));

// a value that is FALSY but present — membership is about the key, not
// the value (0, "", false all say true)
const falsy: Record<string, number> = { zero: 0 };
console.log("falsy value present:", Object.hasOwn(falsy, "zero"), falsy["zero"]);
const flags: Record<string, boolean> = { off: false };
console.log("false value present:", Object.hasOwn(flags, "off"), flags["off"]);
const blank: Record<string, string> = { s: "" };
console.log("empty string present:", Object.hasOwn(blank, "s"), JSON.stringify(blank["s"]));

// a NON-LITERAL key, computed at runtime
const which = ["origin", "missing"];
for (const k of which) console.log("computed", k + ":", Object.hasOwn(headers, k));

// a numeric key stringifies (ToPropertyKey), like every other keyed read
const numbered: Record<string, string> = { "7": "seven" };
console.log("numeric key:", Object.hasOwn(numbered, "7"), Object.hasOwn(numbered, "8"));

// every index-VALUE width the gate admits, so the widened read is
// exercised over a refcounted payload as well as a primitive one
type Row2 = { readonly n: number };
const recVals: Record<string, Row2> = { k: { n: 1 } };
console.log("record value:", Object.hasOwn(recVals, "k"), Object.hasOwn(recVals, "z"));
const arrVals: Record<string, readonly string[]> = { list: ["p"] };
console.log("array value:", Object.hasOwn(arrVals, "list"), Object.hasOwn(arrVals, "nope"));
const byteVals: Record<string, Uint8Array> = { buf: new Uint8Array([1]) };
console.log("bytes value:", Object.hasOwn(byteVals, "buf"), Object.hasOwn(byteVals, "x"));
const nested: Record<string, Record<string, string>> = { o: { i: "v" } };
console.log("nested:", Object.hasOwn(nested, "o"), Object.hasOwn(nested["o"]!, "i"));

export {};
