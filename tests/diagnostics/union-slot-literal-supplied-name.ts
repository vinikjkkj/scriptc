// The fences the LITERAL-SUPPLIED-NAME union-slot spread must keep.
//
// Corpus 4711 opens the population: `{ ...normalized, errors }` where the
// source union is the slot's arms minus `errors`, so the shape each branch
// BUILDS is the shape it reads plus the names the literal supplies
// unconditionally. `pairArmsByFieldName` now folds those plain names into the
// source side of its key and pairs INJECTIVELY (a slot arm no source arm maps
// to is never built).
//
// MOST of the ways that could go wrong are not reachable programs, and that is
// worth recording rather than testing: a source with MORE arms than the slot,
// a conditional override naming a field one source arm lacks, and a
// non-overridden field the slot declares at a NARROWER type are each rejected
// by the CHECKER before the lowerer sees them (measured: SC0001 "is not
// assignable", three of three). The lowerer keeps its own tests for them —
// `arms-not-paired`, `cond-override-not-in-every-arm`, `field-not-widenable`,
// all reportable under SCRIPTC_UNIONSLOT_WHY — as invariants, not as user
// diagnostics.
//
// What IS reachable is the case where the relation is well-typed and still
// does not name ONE arm. Both of these stay compile-time refusals rather than
// a guessed arm.

// A — AMBIGUOUS on the slot side. Two slot arms carry the same field-NAME set
// at different field types, so they are two interned shapes with one name set:
// "the arm with these names" does not name one arm. Folding the supplied name
// in changes nothing about that — `tag` is added to both candidates — so the
// site must still refuse. Accepting it would be a coin toss over which arm a
// payload becomes, and tsc is happy either way.
interface AmbSrcA {
  readonly kind: string;
  readonly payload: string;
}
interface AmbSrcB {
  readonly kind: string;
  readonly payload: number;
}
interface AmbDstA {
  readonly kind: string;
  readonly payload: string;
  readonly tag: string;
}
interface AmbDstB {
  readonly kind: string;
  readonly payload: number;
  readonly tag: string;
}
function ambiguousAfterSuppliedName(x: AmbSrcA | AmbSrcB): AmbDstA | AmbDstB {
  return { ...x, tag: "T" };
}
console.log(ambiguousAfterSuppliedName({ kind: "a", payload: "p" }));

// B — an INDEX-SIGNATURE arm. The field-by-field desugar cannot enumerate
// runtime-keyed overflow entries, so the arm shape test refuses before the
// pairing is even consulted. A supplied name does not make the overflow
// copyable.
interface IxSrcA {
  readonly kind: "a";
  readonly [k: string]: string;
}
interface IxSrcB {
  readonly kind: "b";
  readonly b: string;
}
interface IxDstA {
  readonly kind: "a";
  readonly tag: string;
  readonly [k: string]: string;
}
interface IxDstB {
  readonly kind: "b";
  readonly b: string;
  readonly tag: string;
}
function indexSignatureArm(x: IxSrcA | IxSrcB): IxDstA | IxDstB {
  return { ...x, tag: "T" };
}
console.log(indexSignatureArm({ kind: "b", b: "y" }).tag);
