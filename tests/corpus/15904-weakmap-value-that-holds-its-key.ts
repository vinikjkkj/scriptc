// A WeakMap whose VALUE reaches its own KEY: an ephemeron.
//
// Node collects such a pair once nothing but the table reaches the key,
// because the table holds the value only while the key is alive. This
// runtime holds the value strongly (a table is not a node the collector can
// see through), so the pair is retained until the table itself is released
// at exit. The answers printed here are Node's, and the RC audit is clean at
// exit, which pins two things:
//
//  - the teardown path is safe when a value's release reaches its key's
//    death: the entry is cleared before the value is released, so the same
//    value is never released twice (the double release this program used to
//    trigger as a use-after-free under the sanitizer);
//  - nothing is leaked at exit, so the retention above is bounded by the
//    table's life and not by the program's.
//
// The retention during the run is a known divergence from Node's memory
// behaviour and is recorded as an open limit, not hidden: no output here can
// observe it.

class Node1 {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}

const index = new WeakMap();

const root = new Node1("root");
const child = new Node1("child");
index.set(root, { self: root, label: "r" });
index.set(child, { owner: child, depth: 2 });

const r: any = index.get(root);
console.log("root label:", r.label, "self name:", r.self.name);
console.log("child depth:", (index.get(child) as any).depth);
console.log("has root:", index.has(root), "has child:", index.has(child));

console.log("delete child:", index.delete(child), "has child:", index.has(child));
console.log("delete child again:", index.delete(child));
