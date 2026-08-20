// An object-literal ACCESSOR reaches a dynamic value only through a READ.
//
// `{ get a() {...} }` interns as a shape carrying a reserved '%'-field
// `%get:a` holding a closure; the property name `a` has no data slot at
// all. The dyn object model has no representation for an ENUMERABLE
// accessor (its accessor table is the NON-enumerable
// Object.defineProperty family), so the shape itself does not cross in
// either direction -- both halves are compile-time refusals, pinned in
// tests/diagnostics/an-accessor-carrying-shape-crossing-the-dynamic-boundary.ts.
//
// What DOES cross is the getter's value, once it has been read. This file
// is the behavioural half of that fence: every line is Node's own answer,
// so a boundary that starts admitting the raw shape again -- on either
// backend -- turns this into a differential failure instead of a number in
// a report. The read count matters as much as the values: JS calls a
// getter once per property read, and materializing is one read, at the
// position where it is written.

const log: string[] = [];

function makeCell(start: number) {
  let v = start;
  return {
    id: start,
    get next(): number {
      log.push("next");
      v++;
      return v;
    },
    get current(): number {
      log.push("current");
      return v;
    },
  };
}

// -- the accessor record, used STATICALLY -------------------------------
// Reads dispatch the closure slot; the effects land in source order.
const cell = makeCell(10);
console.log(cell.id, cell.next, cell.current, cell.next);
console.log(log.join(","));

// -- the materialized crossing -----------------------------------------
// One read per member, written where the read belongs, and THAT record
// crosses. The dyn value is a deep copy of data, which is the whole
// reason the boundary can answer for it.
log.length = 0;
const src = makeCell(100);
const snapshot = { id: src.id, next: src.next, current: src.current };
console.log(log.join(","));

const u: unknown = snapshot;

// the dyn record walk, both disciplines
const req = u as { id: number; next: number; current: number };
console.log("req", req.id, req.next, req.current);
const opt = u as { id?: number; missing?: number };
console.log("opt", opt.id, opt.missing);

// the enumeration surfaces, which are where the reserved slot used to
// show up by name
const asRec = u as Record<string, unknown>;
console.log("keys", JSON.stringify(Object.keys(asRec)));
console.log("names", JSON.stringify(Object.getOwnPropertyNames(asRec)));
console.log("json", JSON.stringify(u));
console.log("in", "next" in asRec, "%get:next" in asRec);

const spread: Record<string, unknown> = { ...asRec };
console.log("spread", JSON.stringify(Object.keys(spread)));
const assigned: Record<string, unknown> = Object.assign({}, asRec);
console.log("assign", JSON.stringify(Object.keys(assigned)));

const seen: string[] = [];
for (const k in asRec) {
  seen.push(k);
}
console.log("forin", JSON.stringify(seen));

// the round trip, and the log proves no getter ran on the dyn side
console.log("round", JSON.stringify(JSON.parse(JSON.stringify(u))));
console.log("effects", log.join(","));

// a union arm still selects over the materialized record
function pick(v: unknown): string {
  const w = v as { id: number } | string;
  return typeof w === "string" ? "str:" + w : "rec:" + String(w.id);
}
console.log(pick(u), pick("x" as unknown));

// -- a SET-only accessor is a read of undefined -------------------------
// Node's own answer for a set-only property is `undefined`, so
// materializing it stores `undefined` -- and an undefined-valued member
// simply has no key on the dyn side, which is what an optional field is.
let sunk = 0;
const sinkOnly = {
  set w(v: number) {
    sunk = v;
  },
};
sinkOnly.w = 7;
const materialized: { w?: number } = {};
console.log("sunk", sunk, JSON.stringify(materialized), JSON.stringify(Object.keys(materialized)));
