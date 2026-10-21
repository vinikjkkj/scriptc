// A Date as a union arm or record field of a checked cast out of `unknown`:
// the tag test and the by-reference unbox. (A mismatching value throws a
// catchable TypeError natively where Node just carries the lie along: the
// compiler's documented checked-cast stance, so it is not asserted here.)
type V = string | number | Date | null;
type Row = { when: Date; n: number };
function asV(u: unknown): V {
  return u as V;
}
function asRow(u: unknown): Row {
  return u as Row;
}
function describe(v: V): string {
  if (v === null) return "null";
  if (v instanceof Date) return "date:" + v.getTime();
  return typeof v + ":" + v;
}
function box(x: unknown): unknown {
  return x;
}
const d = new Date(1700000000123);
console.log(describe(asV(box("s"))), describe(asV(box(4))), describe(asV(box(d))), describe(asV(box(null))));
const back = asV(box(d));
console.log(back === d, back instanceof Date);
const row = asRow(box({ when: d, n: 3 }));
console.log(row.when.getTime(), row.n);
