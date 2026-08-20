// The union TAG is decided by the arm MATCHER, never by the arm builder.
//
// A checked cast to a union walks the arms most-specific-first, asks each
// arm's `sc_dm_` predicate, and only then calls that arm's `sc_dc_` builder.
// So the two questions the dyn boundary answers are answered by two
// different emitted functions:
//
//   "which arm of this union does this value belong to?"  -> the MATCHER
//   "can this receiver satisfy this cast?"                -> the BUILDER
//
// That separation is what keeps `["a","b","c"]` an array under
// `{length:number} | string[]` even though an array HAS a `length`, and
// `"abcd"` a string under `{length:number} | string` even though a string
// has one too. It is also the reason the record builder's kind gate cannot
// be relaxed by relaxing the matcher: widening the MATCHER makes an array
// and a string fit the record arm, the wider arm wins, and a value Node
// calls an array comes back tagged as a record with nothing loud to say
// about it. Measured, not argued: over a generated 66-case union
// population, widening the matcher (SCRIPTC_KINDGATE_MATCH=1, the control
// dial in emit-walkers.ts) moves 26 answers and makes 4 of them SILENTLY
// wrong, two of which are pinned right here — `"abcd"` and `""` under
// `{length:number} | string`, which this file asserts stay strings.
//
// Every line below is Node's own answer, so a matcher that starts admitting
// non-object receivers turns this into a differential failure rather than
// into a number in a report.

function armLenOrStrArr(r: { length: number } | string[]): string {
  if (Array.isArray(r)) {
    const a = r as string[];
    return "array n=" + a.length;
  }
  return "record n=" + (r as { length: number }).length;
}

function armLenOrString(r: { length: number } | string): string {
  if (typeof r === "string") return "string n=" + r.length;
  return "record n=" + (r as { length: number }).length;
}

function armLenOrNumber(r: { length: number } | number): string {
  if (typeof r === "number") return "number n=" + r;
  return "record n=" + (r as { length: number }).length;
}

function armLenOrBool(r: { length: number } | boolean): string {
  if (typeof r === "boolean") return "bool v=" + r;
  return "record n=" + (r as { length: number }).length;
}

function armAOrNumArr(r: { a: string } | number[]): string {
  if (Array.isArray(r)) {
    const a = r as number[];
    return "array n=" + a.length;
  }
  return "record a=" + (r as { a: string }).a;
}

// `unknown[]` + a computed index is what defeats the checker's narrowing:
// the cast below is a real runtime crossing on both lanes, not a no-op the
// frontend can fold away.
function hide(v: unknown): unknown {
  const box: unknown[] = [v];
  return box[box.length - 1];
}

const strArr: unknown = hide(["a", "b", "c"]);
const numArr: unknown = hide([1, 2, 3]);
const emptyArr: unknown = hide([]);
const str: unknown = hide("abcd");
const emptyStr: unknown = hide("");
const num: unknown = hide(42);
const bool: unknown = hide(true);
const objLen: unknown = hide({ length: 5 });
const objA: unknown = hide({ a: "va" });
const objBoth: unknown = hide({ a: "va", length: 5 });

// An ARRAY stays an array whichever order the two arms are written in.
console.log(armLenOrStrArr(strArr as { length: number } | string[]));
console.log(armLenOrStrArr(emptyArr as { length: number } | string[]));
console.log(armLenOrStrArr(objLen as { length: number } | string[]));
console.log(armLenOrStrArr(objBoth as { length: number } | string[]));

function armStrArrOrLen(r: string[] | { length: number }): string {
  if (Array.isArray(r)) {
    const a = r as string[];
    return "array n=" + a.length;
  }
  return "record n=" + (r as { length: number }).length;
}
console.log(armStrArrOrLen(strArr as string[] | { length: number }));
console.log(armStrArrOrLen(emptyArr as string[] | { length: number }));
console.log(armStrArrOrLen(objLen as string[] | { length: number }));
console.log(armStrArrOrLen(objBoth as string[] | { length: number }));

// A STRING stays a string. These two are the pins that a widened matcher
// breaks: `"abcd"` has a `length`, so a record arm that admitted non-object
// receivers would swallow it.
console.log(armLenOrString(str as { length: number } | string));
console.log(armLenOrString(emptyStr as { length: number } | string));
console.log(armLenOrString(objLen as { length: number } | string));
console.log(armLenOrString(objBoth as { length: number } | string));

// A NUMBER and a BOOLEAN stay themselves — neither has a `length`, so these
// hold under either stance and are here as the controls that keep the four
// above from being read as "the record arm never wins".
console.log(armLenOrNumber(num as { length: number } | number));
console.log(armLenOrNumber(objLen as { length: number } | number));
console.log(armLenOrNumber(objBoth as { length: number } | number));
console.log(armLenOrBool(bool as { length: number } | boolean));
console.log(armLenOrBool(objLen as { length: number } | boolean));
console.log(armLenOrBool(objBoth as { length: number } | boolean));

// A record arm whose field the array does NOT have: the array arm wins for
// the array, the record arm for the objects, and nothing here depends on
// the kind gate at all.
console.log(armAOrNumArr(numArr as { a: string } | number[]));
console.log(armAOrNumArr(emptyArr as { a: string } | number[]));
console.log(armAOrNumArr(objA as { a: string } | number[]));
console.log(armAOrNumArr(objBoth as { a: string } | number[]));
