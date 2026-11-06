// Object.assign returns its target. Bound to a const, the result is the target record itself: writes through either name are seen
// through the other, and the keys it gained enumerate in the order the source listed them.
interface A { a?: number; b?: number }
interface B { b?: number; c?: number }
function show(r: Record<string, number | undefined>): string { return Object.keys(r).join(",") + ":" + JSON.stringify(r); }

// a source filled by assignment (keys b, a in that order)
const f: A = {}; f.b = 1; f.a = 2;
const base: Record<string, number | undefined> = { z: 0 };
const t = Object.assign(base, f);
console.log(show(t), t["a"], t["b"], t.a, t.b);
t["a"] = 9;
t["c"] = 5;
console.log(base["a"], base["c"], show(base));
base["q"] = 1;
console.log(t["q"], show(t));

// inside a function, chained, several sources
function merge(): string {
  const fa: A = {}; fa.b = 1; fa.a = 2;
  const g: B = { c: 3 };
  const dst: Record<string, number | undefined> = { z: 0 };
  const t1 = Object.assign(dst, fa);
  const t2 = Object.assign(t1, g);
  t2["a"] = 7;
  dst["w"] = 8;
  return show(t1) + "|" + show(t2) + "|" + show(dst) + "|" + String(t1["a"]) + String(t2["c"]) + String(t1.b);
}
console.log(merge());

// a source built in declaration order, and an inline literal source
const f1: A = { a: 1, b: 2 };
const d2: Record<string, number | undefined> = {};
const out = Object.assign(d2, f1, { b: 5 } as B);
console.log(show(out), show(d2));
