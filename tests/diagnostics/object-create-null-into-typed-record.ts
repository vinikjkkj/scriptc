// Object.create(null) assigned to a typed record with declared members is
// refused at compile time (packages/compiler/src/frontend/lowering/null-proto-fence.ts).
// The record would read each declared member when the binding is initialised,
// and a member the program has not written yet is absent there (a throw, where
// Node reads undefined). The record also keeps declared key order, where the
// null-prototype object keeps the order the program writes.

// bson's table idiom: members are written after the binding is initialised.
function parse(s: string): number { return s.length; }
const EJSON: { parse: typeof parse } = Object.create(null);
EJSON.parse = parse;

// Optional members still reorder Object.keys.
const table: { a?: number; b?: number } = Object.create(null);
table.b = 2;
table.a = 1;

// A return slot is the same conversion.
function make(): { a: number } {
  return Object.create(null);
}

console.log(EJSON.parse("abc"), Object.keys(table), make());
