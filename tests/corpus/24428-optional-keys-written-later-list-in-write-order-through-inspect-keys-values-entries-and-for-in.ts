interface P { a?: number; b?: number; c?: number }
function show(tag: string, p: P): void {
  console.log(tag, JSON.stringify(p), Object.keys(p).join(","), Object.values(p).join(","), Object.entries(p).map(([k, v]) => k + "=" + v).join(";"));
  const ks: string[] = [];
  for (const k in p) ks.push(k);
  console.log(tag, ks.join(","));
  console.log(p);
}
const f1: P = {}; f1.b = 1; f1.a = 2;
show("f1", f1);
const f2: P = {}; f2.a = 3; f2.c = 4; f2.b = 5;
show("f2", f2);
delete f2.a; f2.a = 9;
show("f2d", f2);
const f3: P = { c: 7 }; f3.a = 1; f3.b = 2; f3.c = 8;
show("f3", f3);
const g1: P = {}; g1.b = 1; g1.a = 2;
console.log(g1, Object.keys(g1), Object.values(g1), Object.entries(g1));
for (const k in g1) console.log(k);
const g2: P = {}; g2.a = 3; g2.c = 4; g2.b = 5;
console.log(g2);
delete g2.a; g2.a = 9;
console.log(g2, Object.keys(g2));
const g3: P = { c: 7 }; g3.a = 1; g3.b = 2; g3.c = 8;
console.log(g3, JSON.stringify(g3), Object.keys(g3).length);
const g4: P = { a: 1, b: 2 }; delete g4.a;
console.log(g4, Object.keys(g4));
