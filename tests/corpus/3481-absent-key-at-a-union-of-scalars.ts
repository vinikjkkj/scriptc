// An absent index-signature key answers `undefined` when the signature's
// value type is a UNION OF SCALARS — and in the three destinations that
// can say so but never asked.
//
// tsc types `bag[k]` by the signature's value type, so a MISS has nowhere
// to go and the emitted keyed-read helper trapped. Three merges already
// fixed that where the value type is a single scalar: a presence test
// (421c1d6), a dyn slot (90faac7), a binding (0b6bdfb). Each of those
// carried the same restriction — "immutable PRIMITIVES only" — written as
// `string | f64 | bool`, which reads a union of exactly those as a
// COMPOSITE and declines it.
//
// The restriction is about IDENTITY: a composite read into a dyn slot is a
// `dynFrom` deep copy, which would sever aliasing the binding has today.
// A union whose every arm is an immutable scalar has no identity to sever,
// so it is a primitive width for this purpose and takes the same rule.
// `Record<string, string | boolean>` is the shape zapo's app-state index
// args actually have, and `const arg = args[part.name]` on it trapped one
// line before the author's own `arg === undefined` guard.
//
// Two destinations were missing for EVERY value type, union or not:
//
//   - a STRING CONVERSION. `String(bag[k])` and `` `${bag[k]}` `` are total
//     over the dyn kinds (undefined prints "undefined"), exactly like the
//     truthiness test that already widens — but ensureString converted the
//     union to a string BEFORE any dyn destination saw the read, so the
//     read stayed at its trapping width. Concatenation (`+`) too.
//   - `??` with a union RESULT. The scalar-only guard there dropped the
//     widened read and fell back to the non-nullish fold, which SILENTLY
//     discards the default the absent key exists to select.
//
// What still traps, deliberately, is pinned at the bottom: a COMPOSITE
// value type keeps its aliasing (and so keeps its trap on a miss), and a
// declared FIELD slot belongs to code compiled for the narrow type.

const bag = { jid: "a@s", fromMe: true } as unknown as Readonly<Record<string, string | boolean>>;
const strs = { a: "x" } as unknown as Readonly<Record<string, string>>;
const nums = { a: 1 } as unknown as Readonly<Record<string, number | string>>;

// ---------------------------------------------------------------- 1. binding
// The read is answerable; the LOCAL was not. `string | boolean` is the
// width tsc gives it, and no such width holds undefined.
const missBinding = bag["nope"];
console.log("r01", missBinding);
const hitBinding = bag["jid"];
console.log("r02", hitBinding);
const hitBool = bag["fromMe"];
console.log("r03", hitBool);

// The binding's own guards — the reason the author wrote it.
console.log("r04", missBinding === undefined, hitBinding === undefined);
console.log("r05", missBinding ? "truthy" : "falsy", hitBinding ? "truthy" : "falsy");
console.log("r06", typeof missBinding, typeof hitBinding, typeof hitBool);

// A use that NEEDS the value, past a guard tsc believes: sound, so the
// validated bridge never fires and the answer is what it always was.
if (typeof hitBinding === "string") {
  console.log("r07", hitBinding.length, hitBinding.toUpperCase());
}
if (typeof missBinding === "boolean") {
  console.log("r08 unreachable");
} else {
  console.log("r08", "not a boolean");
}

// A number-armed union takes the same rule.
const missNum = nums["nope"];
console.log("r09", missNum, typeof missNum);
const hitNum = nums["a"];
console.log("r10", hitNum, typeof hitNum);

// -------------------------------------------------------- 2. string conversion
// String() and the template are Node's own total ToString.
console.log("r11", String(bag["nope"]), String(bag["jid"]), String(bag["fromMe"]));
console.log("r12", `${bag["nope"]}|${bag["jid"]}|${bag["fromMe"]}`);
console.log("r13", String(missBinding), `${missBinding}`);
// Concatenation is the same conversion with the DEFAULT hint.
console.log("r14", strs["nope"] + "!", strs["a"] + "!");
console.log("r15", "[" + String(nums["nope"]) + "]");
// A single-scalar signature was already fine here — pinned so the two
// spellings stay together.
console.log("r16", String(strs["nope"]), `${strs["nope"]}`);

// ------------------------------------------------------------------- 3. `??`
// The fold this replaces would have DISCARDED the default.
console.log("r17", bag["nope"] ?? "dflt");
console.log("r18", bag["jid"] ?? "dflt");
console.log("r19", bag["fromMe"] ?? "dflt");
console.log("r20", nums["nope"] ?? 42);
console.log("r21", nums["a"] ?? 42);
console.log("r22", strs["nope"] ?? "dflt", strs["a"] ?? "dflt");
// Through the binding, one level down.
console.log("r23", missBinding ?? "dflt", hitBinding ?? "dflt");
// A `false` HIT is not nullish — the fold's other failure mode.
console.log("r24", bag["fromMe"] ?? "wrong", (bag as Record<string, string | boolean>)["fromMe"] === true);

// ------------------------------------------- 4. the shape zapo actually has
// WaAppStateMutationCoordinator.buildMutationIndexFromSchema, reduced: a
// runtime key per schema part, over a bag whose value type is
// `string | boolean`. Every branch below is the real one.
type IndexPart =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "boolString"; readonly name: string }
  | { readonly type: "jidOrZero"; readonly name: string };

function buildIndex(parts: readonly IndexPart[], args: Readonly<Record<string, string | boolean>>): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part.type === "literal") {
      out.push(part.value);
      continue;
    }
    const arg = args[part.name];
    if (part.type === "boolString") {
      out.push(arg ? "1" : "0");
      continue;
    }
    if (arg === null || arg === undefined) {
      out.push(args["fromMe"] !== true ? "?" : "0");
      continue;
    }
    out.push(String(arg));
  }
  return out;
}

const pinParts: readonly IndexPart[] = [
  { type: "literal", value: "pin" },
  { type: "boolString", name: "fromMe" },
  { type: "jidOrZero", name: "target" },
];
console.log("r25", buildIndex(pinParts, { fromMe: true, target: "b@s" }).join(","));
console.log("r26", buildIndex(pinParts, { fromMe: true }).join(","));
console.log("r27", buildIndex(pinParts, { target: "c@s" }).join(","));
console.log("r28", buildIndex(pinParts, {}).join(","));

// ------------------------------------------------- 5. what deliberately stays
// A COMPOSITE value type is NOT widened: the binding keeps the reference
// the record holds, so a mutation through the local is visible through the
// record. A `dynFrom` deep copy would print `1` here — that is the wrong
// answer the "immutable only" restriction exists to prevent, and it is why
// a union with a composite arm is not admitted either.
const lists: Record<string, string[]> = { a: ["one"] };
const alias = lists["a"]!;
alias.push("two");
console.log("r29", lists["a"]!.length, alias.length, lists["a"]!.join("|"));

// A declared FIELD is never absent, so nothing widens and the read is the
// field read it always was.
const mixed: { readonly kind: string; readonly [k: string]: string | boolean } = { kind: "k", extra: "e" };
console.log("r30", mixed.kind, String(mixed["extra"]), String(mixed["gone"]), mixed["gone"] ?? "dflt");
