/* MATERIALIZING a record loses the JS object's toString, and every later
 * ToString folded Object.prototype's constant over a method that exists.
 *
 * `x as LongLike` is the IDENTITY in JS, so String(x) still reaches the
 * prototype's toString; the dynCheck builder and the class -> record
 * projection COPY the declared members into a struct, after which there
 * is nothing left to dispatch through. On base every row below except F
 * printed "[object Object]" -- twelve silent wrong answers -- and the
 * UNION spelling of the same operation (`(number | Rec).toString()`,
 * zapo's `Long.toString` at client/events/business.ts:47) was an SC2020
 * refusal on top of them.
 *
 * The shape now carries a HIDDEN per-instance toString slot -- not a
 * field, no key, invisible to Object.keys/JSON/inspect -- filled by the
 * dynCheck from the source object and by the projection from the class's
 * own method, and NULL wherever nothing carried one, which is exactly
 * when the constant IS Node's answer (row F).
 */
type Rec = { low: number };

class L64 {
  low: number;
  constructor(low: number) {
    this.low = low;
  }
  toString(): string {
    return "L" + this.low;
  }
}

// A record-typed PARAMETER materializes; a union-typed one adds the arm
// spelling the per-union ToString helper answers.
function viaParam(x: Rec): string {
  return String(x) + "|" + x.toString() + "|" + `${x}`;
}
function viaUnion(x: number | Rec): string {
  return String(x) + "|" + x.toString() + "|" + `${x}`;
}

// A. the dynCheck materializer: a source object carrying its own toString
const src = { low: 7, toString: () => "seven" };
const u: unknown = src;
const r = u as Rec;
console.log("A " + viaParam(r));
console.log("B " + viaUnion(r));

// C/D. the class -> record projection, which loses the class pointer
console.log("C " + viaParam(new L64(9)));
console.log("D " + viaUnion(new L64(9)));

// E. array elements are materialized the same way
const arr: Rec[] = [new L64(5), r];
console.log("E " + arr.map((x) => String(x)).join(","));

// F. a plain record: nothing carried a toString, and the constant is
// Node's own answer -- the control that must NOT move.
const q: Rec = { low: 3 };
console.log("F " + viaParam(q));

// G. a virtual toString: the projection's slot dispatches like a call
class Base {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  toString(): string {
    return "B" + this.v;
  }
}
class Sub extends Base {
  override toString(): string {
    return "S" + this.v;
  }
}
type RecV = { v: number };
function show(x: RecV): string {
  return String(x);
}
console.log("G " + show(new Base(1)) + "," + show(new Sub(2)));

// H. a class with NO toString anywhere: the constant, again
class Plain {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}
console.log("H " + show(new Plain(3)));

// I. mutation through the projection is visible: the slot captures the
// INSTANCE, not a copy of it
const m = new L64(1);
console.log("I " + viaParam(m));
m.low = 5;
console.log("J " + viaParam(m));

// K. a toString that THROWS propagates catchably, exactly as Node's does
const bad = { low: 1, toString: () => { throw new Error("boom"); } };
const ub: unknown = bad;
const rb = ub as Rec;
try {
  console.log("K " + String(rb));
} catch (e) {
  console.log("K caught " + (e as Error).message);
}

// M/N. a THROWING toString reached through the UNION spelling, which runs
// through the per-union `sc_us_*` helper rather than the lone-record read.
// Node stops at the FIRST call, so the second half of the expression never
// runs and the counter reads 1 -- the row that says the emitted pending
// check is really there on both backends. (The C tier answered "" and ran
// on, calling the method a second time, until the check was added.)
let hits = 0;
const thrower = {
  low: 1,
  toString: () => {
    hits += 1;
    throw new Error("union-boom" + hits);
  },
};
const ut: unknown = thrower;
const rt = ut as Rec;
function unionConv(x: number | Rec): string {
  return String(x) + "|" + x.toString();
}
try {
  console.log("M " + unionConv(rt));
} catch (e) {
  console.log("M caught " + (e as Error).message);
}
console.log("N " + hits);

// L. the slot is invisible to JSON, to util.inspect and to declaredOrder
// -- it is not a field, so nothing that walks `fields` can see it.
//
// Object.keys(r) is NOT asserted here and the omission is deliberate:
// Node answers "low,toString" because `u as Rec` is the identity and the
// source object has an own toString property, while the materialized
// record has the declared field only. That divergence is the dynCheck's
// WIDTH TOLERANCE, it is byte-identical on base and on this change, and
// asserting it would make this fixture about a different defect.
console.log("L " + JSON.stringify(r) + " " + JSON.stringify([r, q]));

// A source carrying BOTH valueOf and toString is NOT asserted either,
// and that omission is the change's named remainder: `+` is
// ToPrimitive's DEFAULT hint (valueOf first) while String() is the
// STRING hint, ONE slot cannot answer both, so the slot stays empty
// there and both spellings keep the constant they answer on base.
// Measured: `{ low: 2, valueOf: () => 42, toString: () => "TS" }`
// through this same cast prints "TS" / "42" in Node and
// "[object Object]" / "[object Object]" here, unchanged from base.
