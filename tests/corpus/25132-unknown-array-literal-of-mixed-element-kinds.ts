// A literal assigned to `unknown[]` whose elements are of different kinds (arrays beside objects, class instances, scalars). It was refused
// for some mixes (SC1090 / SC2003, "number[] values where K is expected") and threw at run time for others ("a 'number[]' value is not
// representable in the target union"). Every element must arrive as the value it is.
class Tag { toString(): string { return "tag"; } }
class Point { x = 1; y = 2; }

function show(label: string, vs: unknown[]): void {
  console.log(label, vs.length, vs.map((v) => String(v)).join("|"));
}

const a: unknown[] = [[1, 2], { a: 1 }, new Tag()];
show("arrays objects class", a);
const b: unknown[] = [[1, 2], new Tag()];
show("array class", b);
const c: unknown[] = [new Tag(), []];
show("class empty", c);
const d: unknown[] = [[3, [4]], [], new Tag()];
show("nested", d);
const e: unknown[] = [[1, 2], [3, [4]], { a: 1 }, new Tag(), []];
show("everything", e);
const f: unknown[] = [[1, 2], "s", 3, true, null, undefined];
show("scalars", f);
const g: unknown[] = [new Point(), [1], { k: "v" }];
show("point", g);
for (const v of e) console.log(typeof v, Array.isArray(v), v instanceof Tag);
console.log(JSON.stringify(g));
console.log((a[0] as number[]).length, (a[1] as { a: number }).a, a[2] instanceof Tag);
const nested: unknown[] = [[[1], "x"], [{ deep: [2] }, new Tag()]];
show("deep", nested);
