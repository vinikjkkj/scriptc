// A record whose keys are written after construction keeps its keys in write order (a per-instance key list). A widening into
// unknown, a spread, a rest binding and Object.assign copy that order, and so does a record filled through a run-time key and
// returned as unknown.
interface P { a?: number; b?: number; c?: number }
function show(t: string, p: P): void {
  console.log(t, Object.keys(p).join(","), JSON.stringify(p), p, Object.entries(p).map(([k, v]) => k + "=" + v).join(";"));
}
const f1: P = {}; f1.b = 1; f1.a = 2;

// widening into unknown
const wide: unknown = f1;
console.log(Object.keys(wide as object).join(","), JSON.stringify(wide));

// spread, then a late write on the copy, then a copy of the copy
const c1 = { ...f1 };
show("c1", c1);
c1.c = 9;
show("c1+c", c1);
const c5 = { ...c1 };
show("c5", c5);

// a spread that also names a key, and a rest binding
const f2: P = { c: 7 }; f2.a = 1; f2.b = 2;
const c2: P = { ...f2 };
show("c2", c2);
const c3: P = { ...f1, c: 5 };
show("c3", c3);
const { b, ...rest } = f2;
console.log(b, Object.keys(rest).join(","), JSON.stringify(rest));

// delete, then copy
delete f1.b;
const c6 = { ...f1 };
show("c6", c6);
show("f1", f1);

// Object.assign onto a record
const t: P = {};
const f3: P = {}; f3.c = 1; f3.b = 2; f3.a = 3;
Object.assign(t, f3);
show("assigned", t);

// a run-time-key fill returned as unknown
type Name = "omega" | "alpha" | "zeta";
function widened(order: string[]): unknown {
  const view = {} as Record<Name, number | undefined>;
  for (const k of order) {
    view[k as Name] = 2;
  }
  return view;
}
console.log(Object.keys(widened(["zeta", "alpha", "omega"]) as object).join(","));
console.log(Object.keys(widened(["omega", "alpha", "zeta"]) as object).join(","));
