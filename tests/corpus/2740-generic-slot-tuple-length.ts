// `.length` on a member reached through a TYPE PARAMETER's apparent type
// inside a monomorphized generic body. The checker reports the DECLARED
// types there, so `input.schema.parts` reads as the CONSTRAINT's
// `ReadonlyArray<Part>` — an ARRAY — while the instance's own parameter,
// mapped from the RESOLVED signature, is the concrete positional TUPLE the
// call site pinned. Emitting the array `length` intrinsic over that record
// is an ICE (`arrIntrinsic length on non-array record`) on a program tsc
// accepts; the tuple's own answer is the arity CONSTANT.

type Part =
  | { readonly type: "literal"; readonly value: string }
  | { readonly type: "string"; readonly name: string };

interface Schema<
  Name extends string = string,
  Parts extends ReadonlyArray<Part> = ReadonlyArray<Part>,
> {
  readonly name: Name;
  readonly version: number;
  readonly parts: Parts;
}

const TABLE: {
  readonly Mute: Schema<
    "mute",
    readonly [
      { readonly type: "literal"; readonly value: "mute" },
      { readonly type: "string"; readonly name: "id" },
    ]
  >;
  readonly Star: Schema<
    "star",
    readonly [
      { readonly type: "literal"; readonly value: "star" },
      { readonly type: "string"; readonly name: "remote" },
      { readonly type: "string"; readonly name: "id" },
    ]
  >;
} = {
  Mute: {
    name: "mute",
    version: 1,
    parts: [
      { type: "literal", value: "mute" },
      { type: "string", name: "id" },
    ] as const,
  },
  Star: {
    name: "star",
    version: 2,
    parts: [
      { type: "literal", value: "star" },
      { type: "string", name: "remote" },
      { type: "string", name: "id" },
    ] as const,
  },
};

// The arity is a per-INSTANCE constant: two instances, two answers.
function describe<S extends Schema>(input: { schema: S; id: string }): string {
  return `${input.schema.name}:${input.schema.parts.length}:${input.id}`;
}
console.log(describe({ schema: TABLE.Mute, id: "a" }));
console.log(describe({ schema: TABLE.Star, id: "b" }));

// The same read straight off the parameter, not through a wrapper record.
function arity<S extends Schema>(schema: S): number {
  return schema.parts.length;
}
console.log(arity(TABLE.Mute), arity(TABLE.Star));

// A `this`-rooted receiver folds too (the record path's rule allows an
// identifier or `this` root).
class Holder<S extends Schema> {
  public readonly schema: S;
  public constructor(schema: S) {
    this.schema = schema;
  }
  public count(): number {
    return this.schema.parts.length;
  }
}
console.log(new Holder(TABLE.Mute).count(), new Holder(TABLE.Star).count());

// An ordinary ARRAY `.length` inside a generic body keeps the array
// intrinsic — the probe must not steal it.
function total<T>(rows: readonly T[], extra: T): number {
  return rows.length + (extra === undefined ? 0 : 1);
}
console.log(total<string>(["a", "b", "c"], "d"));
console.log(total<number>([], 1));
