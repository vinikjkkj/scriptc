// An object spread that FOLLOWS explicit properties — `{ queriedJid, ...hit }`,
// `{ schema, operation: "remove", ...indexArgs, ...base }`. The desugar
// appends one entry per copied name, so with no collision the copies
// evaluate after the earlier properties: exactly JS's order. tsc rejects the
// colliding form outright (TS2783, "specified more than once"), so only
// OPTIONAL source fields can reach the override path.
interface Base {
  readonly b: number;
  readonly c: number;
}
interface Three {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}
const base: Base = { b: 2, c: 3 };

// literal property, then the spread
const a1: Three = { a: 1, ...base };
console.log(a1.a, a1.b, a1.c);

// shorthand identifiers, then the spread
interface Hit {
  readonly phoneJid: string;
  readonly lidJid: string;
}
const queriedJid = "q1";
const hit: Hit = { phoneJid: "p1", lidJid: "l1" };
const b1: { readonly queriedJid: string; readonly phoneJid: string; readonly lidJid: string } = {
  queriedJid,
  ...hit,
};
console.log(b1.queriedJid, b1.phoneJid, b1.lidJid);

// property, spread, property: the trailing name still wins over the spread
const c1: Three = { a: 1, ...base, c: 30 };
console.log(c1.a, c1.b, c1.c);

// a pure member READ before the spread (a field read, not a local read)
const holder = { seed: 7 };
const d1: Three = { a: holder.seed, ...base };
console.log(d1.a, d1.b, d1.c);

// an EFFECTFUL property before the spread, no name collision: the call runs
// exactly once and the source is read after it
let ticks = 0;
function bump(): number {
  ticks += 1;
  return ticks;
}
const e1: Three = { a: bump(), ...base };
console.log(e1.a, e1.b, e1.c, ticks);

// two spreads after the explicit property
interface Four {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}
const extra = { d: 4 };
const f1: Four = { a: 1, ...base, ...extra };
console.log(f1.a, f1.b, f1.c, f1.d);

// property then a spread of an OPTIONAL source (the present-test path), both arms
interface Loose {
  readonly a: number;
  readonly b?: number;
  readonly c?: number;
}
function g(o: Base | undefined): Loose {
  return { a: 1, ...o };
}
const g1 = g(base);
const g2 = g(undefined);
console.log(g1.a, g1.b ?? -1, g1.c ?? -1, g2.a, g2.b ?? -1, g2.c ?? -1);

// inside a nested literal, the same shape the zapo builders write
interface Node2 {
  readonly tag: string;
  readonly attrs: Attrs;
}
interface Attrs {
  readonly to: string;
  readonly from: string;
}
function build(rest: { readonly from: string }): Node2 {
  return { tag: "iq", attrs: { to: "s.whatsapp.net", ...rest } };
}
const n1 = build({ from: "me" });
console.log(n1.tag, n1.attrs.to, n1.attrs.from);
