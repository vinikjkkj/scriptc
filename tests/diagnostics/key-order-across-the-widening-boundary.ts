// The key-order debt, on the far side of the widening boundary.
//
// A record is a monomorphic struct with no per-instance key list, so its own
// keys are its SHAPE's: `fields` for the set, `declaredOrder` for the order.
// A literal spelled in any OTHER order builds a value JS enumerates
// differently, and enumerating it directly has been refused for a while.
//
// The refusal did not cross the boundary. `const o: object = w` is not a
// pointer copy: the static->dyn walker inserts each key into a fresh dyn
// object, in declaredOrder, right there - so the crossing MATERIALISES the
// wrong key list, and every read of the dyn value from that point (keys,
// for-in, getOwnPropertyNames, entries, values, JSON, Object.assign,
// console.log's own printer) reports it. On a generated population of 480
// cells, 3 direct surfaces refused while 8 widened boundaries x 7 surfaces
// answered a wrong order at exit 0 in SILENCE, on both backends.
//
// Every crossing below is refused at the crossing itself, because that is
// the last place the walk can still name the construction that makes the
// answer wrong. The other half of the fence - that a value built the way
// its shape enumerates crosses freely - is
// tests/corpus/5390-a-record-widened-into-an-object-slot-enumerates-as-node-does.ts.

interface Row {
  inner: number;
  middle: string;
  tag: boolean;
}

interface Wide {
  inner: number;
  middle: string;
  tag: boolean;
  extra: string;
}

const row: Row = { tag: true, inner: 1, middle: "m" };

// 1 — a local typed `object`.
const asLocal: object = row;
console.log(Object.keys(asLocal).join(","));

// 2 — an argument. The crossing is at the call.
function viaParam(o: object): string {
  return JSON.stringify(o);
}
console.log(viaParam(row));

// 3 — an `unknown` slot, the other spelling of the same crossing.
const asUnknown: unknown = row;
console.log(typeof asUnknown);

// 4 — an ARRAY of them: the array crosses as one value and the walker
// recurses into the record elements, so the composite carries it too.
const asArray: object[] = [row];
console.log(Object.keys(asArray[0]!).join(","));

// 5 — a record FIELD.
const asField: { v: object } = { v: row };
console.log(Object.keys(asField.v).join(","));

// 6 — the SET half of the same debt: a width copy ends the keys the
// narrower shape does not name, and JS would keep them.
const wide: Wide = { inner: 1, middle: "m", tag: true, extra: "x" };
const narrow: Row = wide;
const narrowWidened: object = narrow;
console.log(JSON.stringify(narrowWidened));

// 7 — a SPREAD inherits its source's enumeration, so `{ ...row }` is wrong
// the same way `row` is, and enumerating the copy is refused too.
console.log(JSON.stringify({ ...row }));
