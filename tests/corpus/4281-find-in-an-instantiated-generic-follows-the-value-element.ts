// An array method called inside an INSTANTIATED generic body, where the
// checker's element is the CONSTRAINT's union and the receiver's VALUE
// carries the instantiation's own, narrower element.
//
// The two disagree, and every helper the array tables build takes the
// receiver as `array<elem>` — so `.find`'s re-tag route declined rather
// than hand the validator an ill-typed argument, and reported
//   '.find' on '<the constraint union>'-element arrays (the found element
//   would need a union re-tag that is not supported yet)
// The message is misleading: the re-tag was always supported and every arm
// maps. What was missing is the ELEMENT — dispatch follows the VALUE, the
// same rule 4251 applies at the receiver, one level in.
//
// zapo's spelling is `WaAppStateMutationCoordinator.ts:94`, which is TWO
// rows of the census because `buildMutationIndexFromSchema` is instantiated
// twice: one instance's `schema.indexParts` lowers `array<record>` and the
// other's a two-arm union of its own. Both are transcribed below.
//
// CONTROLS that compiled before this rule and must keep answering
// identically:
//   - the same body instantiated at the FULL constraint union (the element
//     IS the checker's, so the existing re-tag route runs)
//   - the same call on a plain, non-generic array of the constraint union
//   - `.findIndex`, `.some` and `.filter` over the same instantiated
//     receivers (no re-tag involved; they must not move)
//   - a mapped-over element whose result type is the callback's, not the
//     element's

type Part =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "jid"; readonly name: string }
  | { readonly type: "boolString"; readonly name: string }
  | { readonly type: "enum"; readonly name: string; readonly protoEnum: string };

interface Schema<IndexParts extends ReadonlyArray<Part> = ReadonlyArray<Part>> {
  readonly name: string;
  readonly indexParts: IndexParts;
}

// --- the site: `.find` whose result is the CHECKER's `Part | undefined` ----
function describe<S extends Schema>(schema: S): string {
  const fromMeSlot = schema.indexParts.find(
    (p) => p.type === "boolString" && p.name === "fromMe",
  );
  return `${schema.name}:${fromMeSlot === undefined ? "none" : fromMeSlot.type}`;
}

// Instantiation A — ONE shape: the receiver lowers `array<record>`, and the
// found element is an IDENTICAL arm of the checker's result union, so no
// re-tag is needed at all.
type OnlyJid = { readonly type: "jid"; readonly name: string };
const ONE: Schema<ReadonlyArray<OnlyJid>> = {
  name: "one",
  indexParts: [{ type: "jid", name: "chatJid" }],
};

// Instantiation B — TWO shapes: the receiver lowers `array<union>`, a
// DIFFERENT union from the checker's, and the found element re-tags arm-wise
// into the result.
type LiteralOrBool =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "boolString"; readonly name: string };
const TWO: Schema<ReadonlyArray<LiteralOrBool>> = {
  name: "two",
  indexParts: [
    { type: "literal", value: "star" },
    { type: "boolString", name: "fromMe" },
  ],
};

// CONTROL — instantiated at the FULL constraint union: the element IS the
// checker's, `elemIsTheValue` was true all along and the existing re-tag
// route answered.
const FULL: Schema<ReadonlyArray<Part>> = {
  name: "full",
  indexParts: [
    { type: "literal", value: "mute" },
    { type: "jid", name: "chatJid" },
    { type: "enum", name: "mode", protoEnum: "Mode" },
  ],
};

console.log(describe(ONE));
console.log(describe(TWO));
console.log(describe(FULL));

// The found value is USED, not just tested — the wrap/re-tag has to carry a
// readable payload out of the loop, not merely a tag.
function firstName<S extends Schema>(schema: S): string {
  // tsc 5.5 INFERS a type predicate for this single-expression test, so the
  // call is typed narrower than the element union — the predicate-narrowed
  // re-tag route, exercised here over an adopted element.
  const slot = schema.indexParts.find((p) => p.type !== "literal");
  return slot === undefined ? "-" : slot.name;
}
console.log("firstName:", firstName(ONE), firstName(TWO), firstName(FULL));

// --- CONTROL: the same call on a plain, non-generic array -------------------
function plainFind(parts: readonly Part[]): string {
  const slot = parts.find((p) => p.type === "boolString");
  return slot === undefined ? "none" : slot.type;
}
console.log("plain:", plainFind([{ type: "boolString", name: "fromMe" }]), plainFind([]));

// --- CONTROLS: the neighbours of `.find` over the SAME receivers ------------
function counts<S extends Schema>(schema: S): string {
  const idx = schema.indexParts.findIndex((p) => p.type === "boolString");
  const anyJid = schema.indexParts.some((p) => p.type === "jid");
  const allTyped = schema.indexParts.every((p) => p.type.length > 0);
  // `: boolean` on purpose — an INFERRED predicate here would narrow the
  // result to a multi-arm sub-union, which is `.filter`'s own separate fence
  // and not this fixture's subject.
  const named = schema.indexParts.filter((p): boolean => p.type !== "literal");
  const tags = schema.indexParts.map((p) => p.type).join("+");
  return `${idx}/${anyJid}/${allTyped}/${named.length}/${tags}`;
}
console.log("counts one:", counts(ONE));
console.log("counts two:", counts(TWO));
console.log("counts full:", counts(FULL));

// --- FROM THE NODE ORACLE, not from the implementation ----------------------
// `.find` answers the ELEMENT, not a copy of it: `xs.find(p) === xs[i]` in
// JS, so a later write through the found value is visible in the array and
// `===` against the array slot is true. The re-tag this rule enables wraps
// a payload under a different tag; a re-tag that LIFTED instead would get
// the value right and the identity wrong, and no trap census could see it.
// Nothing in the code under test suggested this case — JS's own contract
// did.
type Slot = { readonly type: "jid"; name: string };
const MUT: Schema<ReadonlyArray<Slot>> = {
  name: "mut",
  indexParts: [
    { type: "jid", name: "first" },
    { type: "jid", name: "second" },
  ],
};
function findAndRename<S extends Schema<ReadonlyArray<Slot>>>(schema: S): string {
  const slot = schema.indexParts.find((p) => p.name === "second");
  if (slot === undefined) return "missing";
  const identical = slot === schema.indexParts[1];
  slot.name = "renamed";
  return `${identical}/${schema.indexParts[1]!.name}`;
}
console.log("identity:", findAndRename(MUT));
console.log("after:", MUT.indexParts.map((p) => p.name).join(","));

// The callback runs left to right and exactly until the first hit — JS's
// order guarantee, observable through a side effect.
function visitedBeforeHit<S extends Schema>(schema: S): string {
  const seen: string[] = [];
  const hit = schema.indexParts.find((p) => {
    seen.push(p.type);
    return p.type === "boolString";
  });
  return `${seen.join(">")}|${hit === undefined ? "none" : hit.type}`;
}
console.log("order one:", visitedBeforeHit(ONE));
console.log("order two:", visitedBeforeHit(TWO));
console.log("order full:", visitedBeforeHit(FULL));

// --- CONTROL: findLast over the same shape ----------------------------------
function lastNonLiteral<S extends Schema>(schema: S): string {
  const slot = schema.indexParts.findLast((p) => p.type !== "literal");
  return slot === undefined ? "-" : slot.type;
}
console.log("last:", lastNonLiteral(ONE), lastNonLiteral(TWO), lastNonLiteral(FULL));
