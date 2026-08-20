// A record that crosses into an `object`/`unknown` slot: what the crossing
// has to answer, on every boundary the crossing has and every surface that
// reads it back.
//
// The crossing is not a pointer copy. `toDynHelper` walks the shape and
// INSERTS each key into a fresh dyn object, in the shape's declared order,
// so the key list - set and order both - is materialised right there, and
// from that moment Object.keys, for-in, getOwnPropertyNames, entries,
// values, JSON and Object.assign all read it back. A value BUILT the way
// its shape enumerates has to survive all of that byte for byte; a value
// built any other way is refused at the crossing now (SC1090 - see
// tests/diagnostics/key-order-across-the-widening-boundary.ts), and this
// program is the other half of that fence: the proof it lets the correct
// programs through, on nine boundaries at once.
//
// Node v25.9.0 is the oracle for every line.

interface Row {
  inner: number;
  middle: string;
  tag: boolean;
}

function keysOf(o: object): string {
  return Object.keys(o).join(",");
}

function namesOf(o: object): string {
  return Object.getOwnPropertyNames(o).join(",");
}

function forInOf(o: object): string {
  let acc = "";
  for (const k in o) acc += k + "|";
  return acc;
}

function everySurface(label: string, o: object): void {
  console.log(label, "keys", keysOf(o));
  console.log(label, "names", namesOf(o));
  console.log(label, "forin", forInOf(o));
  console.log(label, "json", JSON.stringify(o));
  console.log(label, "entries", JSON.stringify(Object.entries(o)));
  console.log(label, "values", JSON.stringify(Object.values(o)));
  console.log(label, "assign", JSON.stringify(Object.assign({}, o)));
}

const row: Row = { inner: 1, middle: "m", tag: true };

// 1 — a local typed `object`.
const asLocal: object = row;
everySurface("local", asLocal);

// 2 — a parameter.
function viaParam(o: object): object {
  return o;
}
everySurface("param", viaParam(row));

// 3 — a return type.
function viaReturn(): object {
  return row;
}
everySurface("ret", viaReturn());

// 4 — an array element. The ARRAY crosses as one value and the walker
// recurses into the record elements, so this is the composite spelling of
// the same crossing.
const asArray: object[] = [row];
everySurface("arrayElem", asArray[0]!);

// 5 — a record field.
const asField: { v: object } = { v: row };
everySurface("recField", asField.v);

// 6 — a class field.
class Box {
  readonly v: object;
  constructor(v: object) {
    this.v = v;
  }
}
everySurface("classField", new Box(row).v);

// 7 — a nullable union slot.
const asUnion: object | null = row;
if (asUnion !== null) everySurface("union", asUnion);

// 8 — a module-scope slot.
const asGlobal: object = row;
everySurface("global", asGlobal);

// 9 — an `unknown` parameter, the other spelling of the same slot.
function viaUnknown(u: unknown): string {
  return JSON.stringify(u);
}
console.log("unknown json", viaUnknown(row));

// A SPREAD of the same record keeps the order too - the spread inherits its
// source's enumeration, and this source has nothing to inherit.
const copied: Row = { ...row };
console.log("spread json", JSON.stringify(copied));
console.log("spread widened", keysOf(copied as object));

// And the second value of the same shape, spelled the same way, reads the
// same: the risk rides the VALUE, so a correct sibling is not tarred by a
// wrong one elsewhere in the program.
const other: Row = { inner: 9, middle: "n", tag: false };
everySurface("sibling", other);
