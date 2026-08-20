// The INTEGER half of JS own-key order, carried across the widening
// boundary.
//
// tests/corpus/2765 pins the rule inside one process: array-index keys
// ascending FIRST, then every other string key in insertion order, and
// "array index" is the spec's narrow test - a canonical decimal below
// 2^32-1, so "4294967294" sorts ahead while "4294967295", "01", "-1" and
// "1.5" are ordinary string keys holding their insertion slot.
//
// This program asks the same question of a record that has WIDENED into an
// `object`/`unknown` slot, where the answer comes from a different place:
// the shape's declared order, computed by esOwnKeyOrder at intern time and
// replayed by the record->dyn walker. The two halves of that answer do not
// have the same standing - the string half cannot be right for a value the
// shape's order does not describe, which is what the crossing fence
// refuses now - so the integer half is worth its own proof that it is.
//
// Node v25.9.0 is the oracle for every line.

interface Mixed {
  "2": string;
  alpha: number;
  "10": string;
  beta: number;
}

interface Edges {
  "4294967294": string;
  "4294967295": string;
  "01": string;
  "-1": string;
  "1.5": string;
  "0": string;
  plain: string;
}

function keysOf(o: object): string {
  return Object.keys(o).join(",");
}

function forInOf(o: object): string {
  let acc = "";
  for (const k in o) acc += k + "|";
  return acc;
}

// Spelled in the shape's own enumeration order: the integers are hoisted
// by the SHAPE (esOwnKeyOrder ran at intern time), so a literal that
// spells them in their declaration slots is already in enumeration order
// and carries no order risk at all.
const m: Mixed = { "2": "two", alpha: 3, "10": "ten", beta: 4 };

console.log("direct keys", Object.keys(m).join(","));
console.log("direct json", JSON.stringify(m));

const widened: object = m;
console.log("widened keys", keysOf(widened));
console.log("widened names", Object.getOwnPropertyNames(widened).join(","));
console.log("widened forin", forInOf(widened));
console.log("widened json", JSON.stringify(widened));
console.log("widened entries", JSON.stringify(Object.entries(widened)));
console.log("widened assign", JSON.stringify(Object.assign({}, widened)));

function viaParam(o: object): string {
  return Object.keys(o).join(",");
}
console.log("param keys", viaParam(m));

const inArray: object[] = [m];
console.log("array keys", keysOf(inArray[0]!));

// The four spellings that LOOK numeric and are not array indices, beside
// the two that are. Spelled in the shape's order, so the only question is
// whether the two sides agree about which of them hoists.
const e: Edges = {
  "4294967294": "max-index",
  "4294967295": "past-the-end",
  "01": "leading-zero",
  "-1": "negative",
  "1.5": "fractional",
  "0": "zero",
  plain: "plain",
};
console.log("edges direct", Object.keys(e).join(","));
const edgesWidened: object = e;
console.log("edges widened", keysOf(edgesWidened));
console.log("edges forin", forInOf(edgesWidened));
console.log("edges json", JSON.stringify(edgesWidened));
