// A Date crossing into an `unknown` slot by reference: identity, typeof,
// instanceof, narrowing back, JSON.stringify's toJSON hook, equality.
function tell(v: unknown): string {
  if (v instanceof Date) return "date:" + v.getTime();
  return typeof v;
}
function ident(v: unknown): unknown {
  return v;
}
function same(a: unknown, b: unknown): boolean {
  return a === b;
}
function json(v: unknown): string {
  return JSON.stringify(v);
}
const d = new Date(1700000000123);
const e = new Date(1700000000123);
console.log(tell(d), tell(new Date(NaN)), tell(5), tell("s"), tell(null), tell(undefined), tell({ a: 1 }), tell([1]));
console.log(same(d, d), same(d, e), same(ident(d), d), same(d, 1700000000123));
const back = ident(d) as Date;
console.log(back === d, back.getTime(), back.toISOString());
console.log(json(d), json(new Date(NaN)), json({ at: d, n: 1 }), json([d, d]));
const arr: unknown[] = [d, 1, "x", null];
console.log(arr.length, tell(arr[0]), tell(arr[1]));
