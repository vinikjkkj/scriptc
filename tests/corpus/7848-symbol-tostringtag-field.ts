// The well-known Symbol.toStringTag as a record field: an object literal
// that spells it, a read through the key, Object.prototype.toString over it,
// and sql-escaper's Temporal-shaped value.
type Tagged = {
  readonly [Symbol.toStringTag]: `Temporal.${string}`;
  readonly epochMilliseconds?: number;
  toString(): string;
};
function tagOf(v: Tagged): string {
  return v[Symbol.toStringTag];
}
const plain: Tagged = {
  [Symbol.toStringTag]: "Temporal.PlainDateTime",
  toString: () => "2024-05-06T07:08:09",
};
const instant: Tagged = {
  [Symbol.toStringTag]: "Temporal.Instant",
  epochMilliseconds: 1700000000123,
  toString: () => "2023-11-14T22:13:20.123Z",
};
console.log(tagOf(plain), tagOf(instant), plain.toString(), instant.epochMilliseconds, plain.epochMilliseconds);
console.log(String(plain), String(instant));
const probe = (value: unknown): string => Object.prototype.toString.call(value);
console.log(probe(plain), probe(instant), probe({}), probe(new Date(0)));
const isTemporal = (value: unknown): boolean => Object.prototype.toString.call(value).startsWith("[object Temporal.");
console.log(isTemporal(plain), isTemporal(instant), isTemporal({}));
