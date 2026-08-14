// The instantiation whose resolved type carries an INDEX SIGNATURE rather
// than named properties — and the one zapo actually performs.
//
// 3451 instantiates at concrete schemas, so the mapped type resolves to
// named fields (`{ jid: string }`). The real client does not: it looks the
// schema up in a table and widens the result to the BASE schema type
//
//     const resolved = WA_APPSTATE_SCHEMAS[input.schema] as WaAppstateSchema
//
// so S binds to the base. `S['indexParts'][number]` is then the whole part
// UNION, whose `name` is `string` rather than a literal, and the key remap
// produces no named key at all. Asked for properties the resolved type
// still answers "none" — but it has an index signature,
// `[string]: string | boolean`, and THAT is the honest layout: the body
// reads `args[part.name]` with a runtime key, which is exactly what an
// index-signature record is for.
//
// Worth its own fixture because the two resolutions exercise different
// machinery on the far side of the table (declared fields vs the overflow
// store) from one symbolic type, and because a fix verified only against
// 3451's shape would look complete while leaving the real one trapped.

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

// The remove twin: the same symbolic parameter under a second generic, so
// one function's table cannot be what makes the other compile.
function buildRemoveMutation<S extends Schema>(input: {
  readonly schema: S;
  readonly indexArgs: IndexArgsForSchema<S>;
}): MutationInput {
  return {
    collection: input.schema.collection,
    index: buildIndexFrom(input.schema, input.indexArgs),
    version: input.schema.version,
  };
}

const TABLE: Record<string, Schema> = {
  mute: {
    name: "mute",
    collection: "regular",
    version: 1,
    indexParts: [
      { type: "literal", value: "mute" },
      { type: "jid", name: "jid" },
    ],
  },
  pin: {
    name: "pin",
    collection: "regular_high",
    version: 3,
    indexParts: [
      { type: "literal", value: "pin" },
      { type: "boolString", name: "fromMe" },
      { type: "jid", name: "target" },
    ],
  },
};

function setMutation(key: string, args: Record<string, string | boolean>, stamp: number): MutationInput {
  const resolved = TABLE[key] as Schema;
  return buildSetMutation({
    schema: resolved,
    indexArgs: args as unknown as IndexArgsForSchema<typeof resolved>,
    timestamp: stamp,
  });
}

function removeMutation(key: string, args: Record<string, string | boolean>): MutationInput {
  const resolved = TABLE[key] as Schema;
  return buildRemoveMutation({
    schema: resolved,
    indexArgs: args as unknown as IndexArgsForSchema<typeof resolved>,
  });
}

console.log(JSON.stringify(setMutation("mute", { jid: "a@s" }, 7)));
console.log(JSON.stringify(setMutation("pin", { fromMe: true, target: "b@s" }, 11)));
console.log(JSON.stringify(setMutation("pin", { fromMe: false, target: "c@s" }, 0)));
console.log(JSON.stringify(removeMutation("mute", { jid: "d@s" })));
console.log(JSON.stringify(removeMutation("pin", { fromMe: true, target: "e@s" })));

// NOT exercised here: a key the args bag does not carry. `Record<string,
// string | boolean>` has no undefined arm, so a MISSING-key read throws
// `record has no key` where Node yields undefined — and that is a
// pre-existing property of index-signature reads, not of this table. Five
// lines with no generic in them reproduce it identically on main:
//
//     const bag = {} as unknown as Readonly<Record<string, string>>
//     console.log(String(bag['nope']))    // Node: "undefined"; scriptc: throws
//
// It belongs to whoever widens runtime-keyed reads to `V | undefined`. It
// is named here because this fixture is what makes the surrounding code
// compile, so it is the change that puts that read within reach.
