// mongodb's UpdateFilter shape ($inc over OnlyFieldsOfType): over an untyped schema the checker reports the intersection's own index
// signature as `undefined`, over a typed schema named fields beside the index signature. Both are written, read and printed.
type NumericType = number | bigint;
type IsAny<Type, ResultIfAny, ResultIfNotAny> = true extends false & Type ? ResultIfAny : ResultIfNotAny;
type KeysOfAType<TSchema, Type> = { [key in keyof TSchema]: NonNullable<TSchema[key]> extends Type ? key : never }[keyof TSchema];
type KeysOfOtherType<TSchema, Type> = { [key in keyof TSchema]: NonNullable<TSchema[key]> extends Type ? never : key }[keyof TSchema];
type AcceptedFields<TSchema, FieldType, AssignableType> = { readonly [key in KeysOfAType<TSchema, FieldType>]?: AssignableType };
type NotAcceptedFields<TSchema, FieldType> = { readonly [key in KeysOfOtherType<TSchema, FieldType>]?: never };
type OnlyFieldsOfType<TSchema, FieldType = any, AssignableType = FieldType> = IsAny<
  TSchema[keyof TSchema],
  AssignableType extends FieldType ? Record<string, FieldType> : Record<string, AssignableType>,
  AcceptedFields<TSchema, FieldType, AssignableType> & NotAcceptedFields<TSchema, FieldType> & Record<string, AssignableType>
>;
type UpdateFilter<TSchema> = { $inc?: OnlyFieldsOfType<TSchema, NumericType | undefined>; $set?: Partial<TSchema> };

type Untyped = { [key: string]: unknown };
type Typed = { n: number; label: string };

function describe(tag: string, u: UpdateFilter<Untyped>): string {
  return tag + ":" + JSON.stringify(u) + ":" + (u.$inc !== undefined) + ":" + (u.$inc === undefined ? "-" : String(u.$inc["x"]));
}
const empty: UpdateFilter<Untyped> = { $inc: {} };
const none: UpdateFilter<Untyped> = {};
console.log(describe("empty", empty), describe("none", none));

function bump(u: UpdateFilter<Typed>): number {
  const inc = u.$inc;
  return inc === undefined || typeof inc.n !== "number" ? -1 : inc.n;
}
console.log(bump({ $inc: { n: 5 } }), bump({}), bump({ $inc: {} }));
