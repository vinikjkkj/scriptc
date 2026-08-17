// `k in u` where the LOWERED union carries an arm the CHECKER narrowed
// away, and that arm is a PRIMITIVE rather than a unit.
//
// tsc admits `in` only over object-typed operands, so a primitive arm
// reaching the lowering is one a narrowing removed while the lowered
// union still holds it — exactly the provenance of the `undefined` and
// `null` arms the classifier already handled. Before this rule the
// classifier BROKE on such an arm and the whole site fenced, taking the
// record arms beside it down with it.
//
// zapo's spelling is `newsletter/content.ts:295` — `'mimetype' in content`
// over a 17-arm protobuf union whose seventeenth arm is a bare string.
// Sixteen arms answered; the classifier stopped at the string.
//
// WHAT THIS FILE CANNOT TEST, and why it is written down instead:
// the primitive arm's own answer is Node's TypeError, whose message
// interpolates the VALUE ("… to search for 'mimetype' in abc"). That term
// is DEFENSIVE and no compiled program can execute it: to reach it a
// value would have to carry the primitive tag at a site the checker
// narrowed past, and the union representation check ("a 'string' value is
// not representable in the target union") throws at the narrowing itself,
// before the `in`. Measured, not assumed — an `as`-cast version of this
// file died there. The term's text is verified instead by reading the
// emitted C, where it is the 53-byte static prefix
// "Cannot use 'in' operator to search for 'mimetype' in " with the
// String()d arm concatenated at run time. Node's exact wording, measured
// on v25.9.0:
//
//   "x" in "abc" -> Cannot use 'in' operator to search for 'x' in abc
//   "x" in ""    -> Cannot use 'in' operator to search for 'x' in
//   "x" in 5     -> Cannot use 'in' operator to search for 'x' in 5
//   "x" in true  -> Cannot use 'in' operator to search for 'x' in true
//
// CONTROLS that compiled all along and must keep answering identically:
//   - the same key over a union with NO primitive arm
//   - a union with a unit arm (the shape this one generalises)
//   - the optional-slot (per-value) arm, alone and beside a primitive arm

type WithMime = { readonly type: "image"; readonly mimetype: string };
type NoMime = { readonly type: "sticker" };
type Content = WithMime | NoMime | string;

// An honest predicate: narrows to a SUB-union, which is the one shape
// that does NOT collapse the lowered union down to a single arm — so the
// string arm survives into the lowering and the classifier meets it.
function notAString(c: Content): c is WithMime | NoMime {
  return typeof c !== "string";
}

function explicitMimetype(content: Content): string | null {
  if (!notAString(content)) return "<string>";
  return "mimetype" in content && content.mimetype ? content.mimetype : null;
}

console.log("withmime:", explicitMimetype({ type: "image", mimetype: "image/webp" }));
console.log("nomime:", explicitMimetype({ type: "sticker" }));
console.log("emptymime:", explicitMimetype({ type: "image", mimetype: "" }));
console.log("isstring:", explicitMimetype("plain"));

// The bare membership answer, without the `&& content.mimetype` guard.
function hasMimetype(content: Content): string {
  if (!notAString(content)) return "n/a";
  return "mimetype" in content ? "yes" : "no";
}
console.log("has-withmime:", hasMimetype({ type: "image", mimetype: "image/webp" }));
console.log("has-empty:", hasMimetype({ type: "image", mimetype: "" }));
console.log("has-nomime:", hasMimetype({ type: "sticker" }));

// A key NO record arm declares: every record arm answers no, and the
// primitive arm contributes nothing at all.
function hasAbsent(content: Content): string {
  if (!notAString(content)) return "n/a";
  return "nope" in content ? "yes" : "no";
}
console.log("absent-withmime:", hasAbsent({ type: "image", mimetype: "x" }));
console.log("absent-nomime:", hasAbsent({ type: "sticker" }));

// A key EVERY record arm declares.
function hasType(content: Content): string {
  if (!notAString(content)) return "n/a";
  return "type" in content ? "yes" : "no";
}
console.log("type-withmime:", hasType({ type: "image", mimetype: "x" }));
console.log("type-nomime:", hasType({ type: "sticker" }));

// --- a NUMBER arm and a BOOLEAN arm, same shape ------------------------------
type Numeric = { readonly n: number } | { readonly other: number } | number;
function notANumber(v: Numeric): v is { readonly n: number } | { readonly other: number } {
  return typeof v !== "number";
}
function inNumeric(v: Numeric): string {
  if (!notANumber(v)) return "n/a";
  return "n" in v ? "yes" : "no";
}
console.log("num-n:", inNumeric({ n: 1 }));
console.log("num-other:", inNumeric({ other: 2 }));
console.log("num-prim:", inNumeric(7));

type Flagged = { readonly f: string } | { readonly g: string } | boolean;
function notABool(v: Flagged): v is { readonly f: string } | { readonly g: string } {
  return typeof v !== "boolean";
}
function inFlagged(v: Flagged): string {
  if (!notABool(v)) return "n/a";
  return "f" in v ? "yes" : "no";
}
console.log("flag-f:", inFlagged({ f: "x" }));
console.log("flag-g:", inFlagged({ g: "y" }));
console.log("flag-prim:", inFlagged(true));

// --- CONTROL: no primitive arm at all ----------------------------------------
type TwoRecords = { readonly a: number } | { readonly b: number };
function inTwoRecords(v: TwoRecords): boolean {
  return "a" in v;
}
console.log("control-tworecords:", inTwoRecords({ a: 1 }), inTwoRecords({ b: 2 }));

// --- CONTROL: a UNIT arm (the shape this rule generalises) -------------------
type MaybeRecord = { readonly a: number } | { readonly b: number } | undefined;
function defined(v: MaybeRecord): v is { readonly a: number } | { readonly b: number } {
  return v !== undefined;
}
function inMaybe(v: MaybeRecord): string {
  if (!defined(v)) return "n/a";
  return "a" in v ? "yes" : "no";
}
console.log("control-unit:", inMaybe({ a: 1 }), inMaybe({ b: 2 }), inMaybe(undefined));

// --- CONTROL: a unit arm AND a primitive arm in one union --------------------
type Mixed = { readonly a: number } | { readonly b: number } | string | null;
function isRec(v: Mixed): v is { readonly a: number } | { readonly b: number } {
  return typeof v === "object" && v !== null;
}
function inMixed(v: Mixed): string {
  if (!isRec(v)) return "n/a";
  return "a" in v ? "yes" : "no";
}
console.log("control-mixed-a:", inMixed({ a: 1 }));
console.log("control-mixed-b:", inMixed({ b: 2 }));
console.log("control-mixed-str:", inMixed("s"));
console.log("control-mixed-null:", inMixed(null));

// --- CONTROL: an OPTIONAL slot beside a primitive arm ------------------------
// The per-value arm reads its slot off the tag-checked narrow; the
// primitive arm beside it must not disturb that. NOT probed here:
// `{ kind: "o", maybe: undefined }` — a field EXPLICITLY assigned
// undefined reads as ABSENT (SEMANTICS.md stance 55) where Node
// answers `true`. Measured on this file and pre-existing: the
// optional-slot arm predates the primitive-arm rule and is untouched
// by it. The corpus is the Node oracle, so a documented divergence
// does not belong in it.
type OptSlot = { readonly kind: "o"; readonly maybe?: string } | { readonly kind: "p" } | string;
function notStr(v: OptSlot): v is { readonly kind: "o"; readonly maybe?: string } | { readonly kind: "p" } {
  return typeof v !== "string";
}
function inOptSlot(v: OptSlot): string {
  if (!notStr(v)) return "n/a";
  return "maybe" in v ? "yes" : "no";
}
console.log("control-slot-present:", inOptSlot({ kind: "o", maybe: "m" }));
console.log("control-slot-empty:", inOptSlot({ kind: "o", maybe: "" }));
console.log("control-slot-absent:", inOptSlot({ kind: "o" }));
console.log("control-slot-other:", inOptSlot({ kind: "p" }));
console.log("control-slot-prim:", inOptSlot("s"));

// --- evaluate-once: the receiver expression runs exactly once ----------------
let effects = 0;
function tap(v: Content): Content {
  effects += 1;
  return v;
}
function tapped(v: Content): string {
  const t = tap(v);
  if (!notAString(t)) return "n/a";
  return "mimetype" in t ? "yes" : "no";
}
console.log("effects:", effects, "answer:", tapped({ type: "image", mimetype: "image/png" }), "after:", effects);
