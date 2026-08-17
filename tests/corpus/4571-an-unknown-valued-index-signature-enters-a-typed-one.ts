// The SECOND of the two refusals zapo's `mutations.set()` carries in
// series, and the one 3453 does not reach.
//
// 3453 pins the KEY half: `WA_APPSTATE_SCHEMAS[input.schema] as
// WaAppstateSchema` binds S to the base, so `IndexArgsForSchema<S>`
// resolves to an index signature rather than named fields. Its args bag is
// typed `Record<string, string | boolean>` — already the destination's own
// value type — so the capture is an identity copy and it compiles.
//
// The real client's bag is not that. `splitFlatInput` walks
// `Object.keys(input)` over a `Readonly<Record<string, unknown>>` and
// hands back two more of the same, so what actually reaches
// `buildSetMutationFromSchema` is
//
//     indexArgs as unknown as IndexArgsForSchema<typeof resolved>
//     //  { [key: string]: unknown }  ->  { [key: string]: boolean | null | string }
//
// Both shapes have ZERO declared fields, so exactly one gate in
// lowerRecordOvfCaptureHelper decides the pair: whether the SOURCE's
// overflow slot can enter the TARGET's. Three arms existed — identity, a
// typed value into a `dyn` slot (dynFrom), and a width lift — and the
// mirror of the second was missing: a `dyn` value into a TYPED slot, which
// is what `dynCheck` is. A source slot holding `unknown` only ever holds
// values `canConvertToDyn` admitted, and the check is emitted only where
// `canDynCheckTo` can test the destination, so the pair composes two
// conversions the compiler already performs in each direction separately.
//
// A per-entry mismatch throws the catchable TypeError this helper's keyed
// writes already throw ("expected boolean | null | string at $, got
// number") — divergence 34, the stance that makes the `as` honest, not a
// new one.
//
// The five cases below are the ones that distinguish the arm from a
// blanket admission: a plain string, a bool-typed part, a nullable part
// carrying null, a key the bag does not hold at all (the read answers
// undefined, JS's own missing-property answer), and a bag whose extra keys
// are not index parts and must ride the overflow untouched.

type IndexPart =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "jid"; readonly name: string }
  | { readonly type: "jidOrZero"; readonly name: string }
  | { readonly type: "boolString"; readonly name: string };

interface Schema<IndexParts extends ReadonlyArray<IndexPart> = ReadonlyArray<IndexPart>> {
  readonly name: string;
  readonly collection: string;
  readonly indexParts: IndexParts;
}

type IndexArgsForSchema<S extends Schema> = {
  readonly [Part in S["indexParts"][number] as Part extends { type: "literal" }
    ? never
    : Part extends { name: infer N extends string }
      ? N
      : never]: Part extends { type: "boolString" }
    ? boolean
    : Part extends { type: "jidOrZero" }
      ? string | null
      : string;
};

function buildIndexFrom<S extends Schema>(schema: S, indexArgs: IndexArgsForSchema<S>): string {
  const args = indexArgs as Readonly<Record<string, string | boolean | null>>;
  const out: string[] = [];
  for (const part of schema.indexParts) {
    if (part.type === "literal") {
      out.push(part.value);
      continue;
    }
    const a = args[part.name];
    if (a === undefined) {
      out.push("<absent>");
    } else if (a === null) {
      out.push("0");
    } else if (a === true) {
      out.push("1");
    } else if (a === false) {
      out.push("");
    } else {
      out.push(a);
    }
  }
  return out.join(",");
}

interface MutationInput {
  readonly collection: string;
  readonly index: string;
}

function buildSetMutation<S extends Schema>(input: {
  readonly schema: S;
  readonly indexArgs: IndexArgsForSchema<S>;
}): MutationInput {
  return { collection: input.schema.collection, index: buildIndexFrom(input.schema, input.indexArgs) };
}

const TABLE: Record<string, Schema> = {
  mute: {
    name: "mute",
    collection: "regular",
    indexParts: [
      { type: "literal", value: "mute" },
      { type: "jid", name: "jid" },
    ],
  },
  pin: {
    name: "pin",
    collection: "regular_high",
    indexParts: [
      { type: "literal", value: "pin" },
      { type: "boolString", name: "fromMe" },
      { type: "jid", name: "target" },
    ],
  },
  contact: {
    name: "contact",
    collection: "critical_unblock_low",
    indexParts: [
      { type: "literal", value: "contact" },
      { type: "jidOrZero", name: "parent" },
      { type: "jid", name: "child" },
    ],
  },
};

// The client's own split: one pass over Object.keys, two bags of unknown.
function splitFlatInput(
  schema: Schema,
  input: Readonly<Record<string, unknown>>,
): { readonly indexArgs: Readonly<Record<string, unknown>>; readonly data: Readonly<Record<string, unknown>> } {
  const indexNames = new Set<string>();
  for (const part of schema.indexParts) {
    if (part.type !== "literal") {
      indexNames.add(part.name);
    }
  }
  const indexArgs: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (key === "schema") {
      continue;
    }
    if (indexNames.has(key)) {
      indexArgs[key] = input[key];
    } else {
      data[key] = input[key];
    }
  }
  return { indexArgs, data };
}

function set(key: string, flat: Readonly<Record<string, unknown>>): string {
  const resolved = TABLE[key] as Schema;
  const split = splitFlatInput(resolved, flat);
  const mutation = buildSetMutation({
    schema: resolved,
    indexArgs: split.indexArgs as unknown as IndexArgsForSchema<typeof resolved>,
  });
  return `${mutation.collection}|${mutation.index}|data=${Object.keys(split.data).sort().join("+") || "-"}`;
}

console.log(set("mute", { schema: "mute", jid: "a@s.whatsapp.net", muted: true }));
console.log(set("pin", { schema: "pin", fromMe: true, target: "b@s.whatsapp.net" }));
console.log(set("pin", { schema: "pin", fromMe: false, target: "c@s.whatsapp.net" }));
console.log(set("contact", { schema: "contact", parent: null, child: "d@s.whatsapp.net", fullName: "D" }));
// A part the bag does not carry: the keyed read answers undefined, which
// is what JS answers for a missing property.
console.log(set("mute", { schema: "mute" }));

// The remove twin, so one call site's helper cannot be what makes the
// other compile — the same pair of shapes reached through a second
// generic instantiation.
function buildRemoveMutation<S extends Schema>(input: {
  readonly schema: S;
  readonly indexArgs: IndexArgsForSchema<S>;
}): MutationInput {
  return { collection: `${input.schema.collection}!`, index: buildIndexFrom(input.schema, input.indexArgs) };
}

function remove(key: string, flat: Readonly<Record<string, unknown>>): string {
  const resolved = TABLE[key] as Schema;
  const mutation = buildRemoveMutation({
    schema: resolved,
    indexArgs: splitFlatInput(resolved, flat).indexArgs as unknown as IndexArgsForSchema<typeof resolved>,
  });
  return `${mutation.collection}|${mutation.index}`;
}

console.log(remove("mute", { schema: "mute", jid: "e@s.whatsapp.net" }));
console.log(remove("contact", { schema: "contact", parent: "f@s.whatsapp.net", child: "g@s.whatsapp.net" }));
