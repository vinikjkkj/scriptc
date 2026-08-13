// A key-remapped mapped type over a generic's own type parameter
// (`IndexArgsForSchema<S>`) is uncompilable AS WRITTEN and fully determined
// WHERE IT IS USED. Asked about the symbolic form the checker hands back
// nothing at all — no properties, no index signature, no constraint, an
// apparent type equal to itself — so mapType is right to refuse it. But the
// SAME type resolves perfectly at the call site that created the
// instantiation, and that answer now travels down on the instantiation
// record (collectSymbolicResolutions).
//
// This is zapo's app-state mutation coordinator: `buildSetMutationFromSchema`
// takes one object parameter carrying `schema: S` beside
// `indexArgs: IndexArgsForSchema<S>`, and its body hands both to
// `buildMutationIndexFromSchema` — an inner generic call whose own resolved
// parameter type is still the symbolic one.
//
// The fixture instantiates at THREE schemas on purpose, because a resolved
// layout carried to the wrong instantiation is a wrong field read at speed:
//   - MUTE and BLK resolve the symbolic type to the SAME layout ({ jid }),
//     so they must share one instance and both stay right;
//   - PIN resolves it to a DIFFERENT layout ({ fromMe, target }), so it must
//     not share theirs.
// If the table were keyed loosely enough for one to answer for the other,
// the index strings below come out reading the wrong field.

type IndexPart =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "jid"; readonly name: string }
  | { readonly type: "boolString"; readonly name: string };

interface Schema<IndexParts extends ReadonlyArray<IndexPart> = ReadonlyArray<IndexPart>> {
  readonly name: string;
  readonly collection: string;
  readonly version: number;
  readonly indexParts: IndexParts;
}

type IndexArgsForSchema<S extends Schema> = {
  readonly [Part in S["indexParts"][number] as Part extends { type: "literal" }
    ? never
    : Part extends { name: infer N extends string }
      ? N
      : never]: Part extends { type: "boolString" } ? boolean : string;
};

interface MutationInput {
  readonly collection: string;
  readonly index: string;
  readonly version: number;
}

function buildIndexFrom<S extends Schema>(schema: S, indexArgs: IndexArgsForSchema<S>): string {
  const args = indexArgs as Readonly<Record<string, string | boolean>>;
  const out: string[] = [];
  for (const part of schema.indexParts) {
    if (part.type === "literal") {
      out.push(part.value);
      continue;
    }
    const a = args[part.name];
    out.push(part.type === "boolString" ? (a ? "1" : "0") : String(a));
  }
  return out.join(",");
}

function buildSetMutation<S extends Schema>(input: {
  readonly schema: S;
  readonly indexArgs: IndexArgsForSchema<S>;
  readonly timestamp: number;
}): MutationInput {
  return {
    collection: input.schema.collection,
    index: buildIndexFrom(input.schema, input.indexArgs),
    version: input.schema.version + input.timestamp,
  };
}

type MuteParts = readonly [
  { readonly type: "literal"; readonly value: "mute" },
  { readonly type: "jid"; readonly name: "jid" },
];
type PinParts = readonly [
  { readonly type: "literal"; readonly value: "pin" },
  { readonly type: "boolString"; readonly name: "fromMe" },
  { readonly type: "jid"; readonly name: "target" },
];
type BlkParts = readonly [
  { readonly type: "literal"; readonly value: "blk" },
  { readonly type: "jid"; readonly name: "jid" },
];

const MUTE: Schema<MuteParts> = {
  name: "mute",
  collection: "regular",
  version: 1,
  indexParts: [
    { type: "literal", value: "mute" },
    { type: "jid", name: "jid" },
  ],
};
const PIN: Schema<PinParts> = {
  name: "pin",
  collection: "regular_high",
  version: 3,
  indexParts: [
    { type: "literal", value: "pin" },
    { type: "boolString", name: "fromMe" },
    { type: "jid", name: "target" },
  ],
};
const BLK: Schema<BlkParts> = {
  name: "blk",
  collection: "critical",
  version: 2,
  indexParts: [
    { type: "literal", value: "blk" },
    { type: "jid", name: "jid" },
  ],
};

// Interleaved on purpose: whichever call site instantiates FIRST must not
// get to answer for the others.
console.log(JSON.stringify(buildSetMutation({ schema: MUTE, indexArgs: { jid: "a@s" }, timestamp: 7 })));
console.log(
  JSON.stringify(buildSetMutation({ schema: PIN, indexArgs: { fromMe: true, target: "b@s" }, timestamp: 11 })),
);
console.log(JSON.stringify(buildSetMutation({ schema: BLK, indexArgs: { jid: "d@s" }, timestamp: 5 })));
console.log(
  JSON.stringify(buildSetMutation({ schema: PIN, indexArgs: { fromMe: false, target: "c@s" }, timestamp: 0 })),
);
console.log(JSON.stringify(buildSetMutation({ schema: MUTE, indexArgs: { jid: "e@s" }, timestamp: 2 })));

// The inner generic called DIRECTLY, so the symbolic parameter is the whole
// parameter rather than a member of one.
console.log(buildIndexFrom(MUTE, { jid: "f@s" }));
console.log(buildIndexFrom(PIN, { fromMe: true, target: "g@s" }));
