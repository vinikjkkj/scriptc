// Dynamic import() of the program's OWN module in a STATIC build. The two
// spellings the static tier serves are a CONST binding of the namespace
// and a CONST destructure of it; both are alias plumbing with no storage,
// so the names resolve to the exporter's own declarations — a class comes
// out a class (`new ns.Thing(4)` is an ordinary construction, and a
// subclass overrides), a `let` export is a LIVE binding, and Object.keys
// folds to Node's sorted key set.
//
// The module EVALUATES once, on the microtask after the importer's
// synchronous code — "B sync-after" prints before "mod evaluated" — and a
// second import of the same specifier does not re-run the body.
//
// `export *` re-exports are part of the namespace Node builds, so they are
// part of this one: agg.ts contributes STARRED through the star chain, and
// both the member read and the destructure must find it.
async function main(): Promise<void> {
  console.log("A sync-before");
  const ns = await import("./mod.ts");
  console.log("keys", Object.keys(ns).join(","));
  console.log("VAL", ns.VAL);
  console.log("greet", ns.greet("x"));
  console.log("default", ns.default);
  console.log("rec", ns.REC.tool, ns.REC.version);
  console.log("list1", ns.LIST[1]);
  const t = new ns.Thing(4);
  console.log("double", t.double());
  const s = new ns.Sub(4);
  console.log("sub double", s.double());
  console.log("sub is Thing", s instanceof ns.Thing);
  console.log("counter", ns.counter);
  console.log("bump", ns.bump());
  console.log("counter after", ns.counter);
  const { VAL, counter, Thing } = await import("./mod.ts");
  console.log("second VAL", VAL, "counter", counter);
  console.log("second Thing", new Thing(5).double());
  const { greet: hello, default: dflt } = await import("./mod.ts");
  console.log("renamed", hello("y"), dflt);
  const agg = await import("./agg.ts");
  console.log("agg keys", Object.keys(agg).join(","));
  console.log("agg", agg.OWN, agg.STARRED);
  const { STARRED } = await import("./agg.ts");
  console.log("starred destructured", STARRED);
}
void main();
console.log("B sync-after");
