// `.find` over a UNION-element array: the found element re-tags arm-wise.
//
// The result of `.find` is the checker's `T | undefined`. For a scalar or
// record element that is one WRAP — the element is one arm of the result.
// For a UNION element it is neither identity nor a wrap: `IndexPart |
// undefined` over a three-armed `IndexPart` is every arm of the element
// union plus undefined, so the found value has to be re-tagged arm by arm.
// The lowering had no plan for that and fenced with SC1090, advising
// "loop and test instead" — the only spelling that worked.
//
// The re-tag itself already existed (unionRetagHelper, the same one a
// spread's sub-union value slot uses); only `.find` never asked for it.
// zapo's spelling is
//
//     schema.indexParts.find(p => p.type === 'boolString' && p.name === 'fromMe')
//
// in WaAppStateMutationCoordinator, a body nothing had ever lowered until
// the instantiation table let the enclosing function compile.
//
// Pinned here: every arm findable, the miss, findLast, the index-carrying
// siblings that never needed the re-tag, an arm order where the found arm
// is NOT the first, and a union element whose result union is the element
// itself (the `T | undefined` element — no re-tag at all, the pre-existing
// identity path).

type IndexPart =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "boolString"; readonly name: string }
  | { readonly type: "jid"; readonly name: string };

const parts: readonly IndexPart[] = [
  { type: "literal", value: "pin" },
  { type: "boolString", name: "fromMe" },
  { type: "jid", name: "target" },
  { type: "boolString", name: "muted" },
];

function describe(p: IndexPart | undefined): string {
  if (p === undefined) return "none";
  if (p.type === "literal") return `literal:${p.value}`;
  return `${p.type}:${p.name}`;
}

// The third arm, found second — the arm-wise re-tag has to carry the tag,
// not the position.
console.log("r01", describe(parts.find((p) => p.type === "boolString" && p.name === "fromMe")));
console.log("r02", describe(parts.find((p) => p.type === "jid")));
console.log("r03", describe(parts.find((p) => p.type === "literal")));
console.log("r04", describe(parts.find((p) => p.type === "jid" && p.name === "zzz")));
console.log("r05", describe(parts.findLast((p) => p.type === "boolString")));
console.log("r06", describe(parts.findLast((p) => p.type === "literal")));
console.log("r07", describe(parts.findLast((p) => p.type === "jid" && p.name === "zzz")));

// The siblings that answer a number or a boolean never needed the re-tag;
// they are here so a change to the shared planning cannot move them.
console.log("r08", parts.findIndex((p) => p.type === "jid"));
console.log("r09", parts.findLastIndex((p) => p.type === "boolString"));
console.log("r10", parts.findIndex((p) => p.type === "jid" && p.name === "zzz"));
console.log("r11", parts.some((p) => p.type === "literal"), parts.every((p) => p.type === "literal"));

// A scalar union element — the same re-tag over unit-free primitive arms.
const mixed: readonly (string | number)[] = ["a", 2, "c", 4];
const firstNum = mixed.find((m) => typeof m === "number");
console.log("r12", firstNum, typeof firstNum);
const lastStr = mixed.findLast((m) => typeof m === "string");
console.log("r13", lastStr, typeof lastStr);
const noBig = mixed.find((m) => typeof m === "number" && m > 100);
console.log("r14", noBig === undefined ? "none" : String(noBig));

// The element union ALREADY carries undefined: the result union IS the
// element type, so the found value passes through with no re-tag. This is
// the pre-existing identity path — a miss and a hit are indistinguishable
// in the value, which is exactly JS's behaviour.
// (`find(s => s === undefined)` is NOT here: tsc infers `s is undefined`
// and types the whole call `undefined`, a bare unit with no static
// representation — SC2011, a different fence and not this one's business.)
const sparse: readonly (string | undefined)[] = ["x", undefined, "z"];
console.log("r15", String(sparse.find((s) => s !== undefined)), String(sparse.find((s) => s === "z")));
console.log("r16", String(sparse.find((s) => s === "nope")));

// The predicate reading each arm's own fields is what makes the element a
// real union at the call — a narrowing inside the callback, a re-tag on
// the way out.
const names = parts
  .map((p) => (p.type === "literal" ? p.value : p.name))
  .join(",");
console.log("r17", names);

// Nested: find over the array of a record field, the shape zapo has.
interface Schema {
  readonly name: string;
  readonly indexParts: readonly IndexPart[];
}
const schema: Schema = { name: "pin", indexParts: parts };
function fromMeSlot(s: Schema): string {
  const slot = s.indexParts.find((p) => p.type === "boolString" && p.name === "fromMe");
  return slot === undefined ? "absent" : describe(slot);
}
console.log("r18", fromMeSlot(schema));
console.log("r19", fromMeSlot({ name: "empty", indexParts: [] }));
console.log("r20", fromMeSlot({ name: "one", indexParts: [{ type: "jid", name: "target" }] }));
