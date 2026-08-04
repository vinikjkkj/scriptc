// dynCheck (the `unknown` OUT direction) over targets whose leaves are
// FUNCTIONS or `unknown`, not just JSON data.
//
// The shape that motivated it is protobufjs's Long: `number | Long | null`
// where Long carries a `toNumber()` method. A dyn parsed from JSON can
// never BE the Long, but the arm's presence used to make the whole union
// unvalidatable, so every protobuf field of that type fenced. The matcher
// now walks the method leaf, so the object arm correctly declines a JSON
// scalar and the number/null arms win.
//
// Only VALID casts live here (Node agrees byte-for-byte — an `as` is a
// no-op under Node). The LYING cast, which scriptc throws on and Node does
// not, is in tests/harness/dyncheck.test.ts.

type Long = { high: number; low: number; toNumber: () => number; unsigned: boolean };
type Stamp = number | Long | null;

function readStamp(u: unknown): string {
  const s = u as Stamp;
  if (s === null) return "null";
  if (typeof s === "number") return "num:" + s;
  return "long:" + s.toNumber();
}

// The object arm must decline both JSON scalars.
console.log(readStamp(JSON.parse("42")));
console.log(readStamp(JSON.parse("null")));

// And accept the real thing when the dyn actually holds one — the round
// trip through the IN direction (a record with a func field boxes) and
// back out.
const lg: Long = { high: 0, low: 8, toNumber: () => 8, unsigned: false };
console.log(readStamp(lg as unknown));

// A record whose leaves are a func AND an `unknown`: both are leaves the
// nested walk had no case for.
type Box = { name: string; f: () => number; extra: unknown };
const src: Box = { name: "b", f: () => 7, extra: { deep: [1, 2, 3] } };
const back = (src as unknown) as Box;
console.log("box:" + back.name + ":" + back.f());

// The func leaf reached through the MATCHER rather than the builder: the
// record is a union ARM, so the arm test is what has to walk the method.
type Wrapped = { tag: string; make: () => number } | number;
function readWrapped(u: unknown): string {
  const w = u as Wrapped;
  if (typeof w === "number") return "n:" + w;
  return "w:" + w.tag + ":" + w.make();
}
console.log(readWrapped({ tag: "t", make: () => 9 } as unknown));
console.log(readWrapped(JSON.parse("5")));

// The OPTIONAL METHOD — a func ARM of a union, which is how `toNumber?:`
// actually interns. Present and absent.
type Opt = { id: string; hook?: () => number };
function readOpt(u: unknown): string {
  const o = u as Opt;
  return o.id + ":" + (o.hook === undefined ? "none" : o.hook());
}
console.log(readOpt({ id: "a", hook: () => 3 } as unknown));
console.log(readOpt(JSON.parse('{"id":"b"}')));

// A record of nothing but `unknown` fields — the whole target says "any
// value fits", which used to read as "no value fits".
type Deps = { one: unknown; two: unknown };
const deps: Deps = { one: 1, two: "x" };
const dback = (deps as unknown) as Deps;
console.log("deps:" + typeof dback.one + ":" + typeof dback.two);

// An ARRAY of records carrying methods, so the element matcher walks it.
type Cell = { at: number; get: () => string };
const cells: Cell[] = [{ at: 1, get: () => "p" }, { at: 2, get: () => "q" }];
const cback = (cells as unknown) as Cell[];
console.log("cells:" + cback.map((c) => c.at + c.get()).join(","));
