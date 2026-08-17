// Was tests/diagnostics/intersection-values.ts, which pinned
//
//   SC2008: values of type 'Branded' cannot be compiled: this intersection
//   resolves to no runtime shape
//
// on `number & { __brand: "id" }` at the producer, at the binding, and twice
// more as SC2004 cascades. All four are gone and the entry stopped failing,
// so the subject moves here, where Node is the oracle.
//
// 2729-primitive-object-intersection.ts already covers `number & Long`,
// where the object part has three REAL members. This is the other end: the
// object part is a phantom brand.
//
// What the value can DO is deliberately narrow. A brand-only intersection
// lowers to the checked-dynamic tree, exactly like `number & Long`, so
// arithmetic on it (SC1100), comparing it (SC1043) and mapping it out of an
// array (SC1090) all still fence today - measured, not assumed: a first
// draft of this fixture did all three and failed to compile. What compiles
// is producing one, holding one, and reading one back out, which is what
// the SC2008 rows used to refuse outright.
//
// The producer has a BODY on purpose - an ambient `declare function` would
// compile to Node's ReferenceError at the call instead, which is the
// declare-erasure stance and a different test.
type Branded = number & { __brand: "id" };
function mint(n: number): Branded {
  return n as Branded;
}
const kept = mint(1);
console.log(kept);

// Held in a record and in an array, which is where a no-runtime-shape
// verdict used to take the whole container down with it.
type Row = { readonly id: Branded; readonly tag: string };
const rows: Row[] = [{ id: mint(7), tag: "a" }, { id: mint(9), tag: "b" }];
console.log(rows.length, rows[0]?.tag, rows[1]?.id);
console.log(rows);

// Round-tripped through a parameter and back out of a return.
function firstId(xs: readonly Row[]): Branded {
  return xs[0]!.id;
}
console.log(firstId(rows));
