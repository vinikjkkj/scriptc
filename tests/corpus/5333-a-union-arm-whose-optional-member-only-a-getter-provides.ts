// A union arm whose member is provided by an ACCESSOR rather than by data.
//
// This is the one documented place where the merged arm walker keeps BOTH
// halves of the pair it replaced. The decision it makes is the MATCH
// predicate's, statement for statement, and the predicate returns a bool
// and cannot run a getter — so it reads own-and-inherited DATA only:
//
//   a REQUIRED member an accessor provides was never MATCHED, so the arm
//     was never taken and the builder's accessor probe sat behind a
//     condition that could not hold. Removing the probe from the arm form
//     is exact, not a widening;
//   an OPTIONAL member is different, because a MISSING key is a match: the
//     arm IS taken, and the accessor is then the only thing that can say
//     what the member holds. That half keeps the hard builder, and with it
//     the hard builder's throw.
//
// Node runs the getter on every read; the materializing cast runs it ONCE
// and copies the answer, so this file reads each member and never counts
// getter invocations — the one thing the two lanes are not obliged to
// agree on. Accessors are `enumerable: false`, matching 4890: an
// enumerable accessor is a separate refusal about enumeration, not about
// the read.

interface WithOpt {
  id: string;
  note?: string;
}
interface WithNum {
  count: number;
}
type Either = WithOpt | WithNum;

function withGetter(base: object, key: string, value: string): unknown {
  Object.defineProperty(base, key, {
    get(): string {
      return value;
    },
    enumerable: false,
    configurable: true,
  });
  return base;
}

// The optional member as plain DATA: the arm is matched on the data read
// and built from it, and nothing about the accessor half is involved.
const plain: unknown = { id: "p", note: "data" };
const p = plain as Either as WithOpt;
console.log("plain", p.id, p.note === undefined ? "none" : p.note);

// The optional member MISSING outright: the arm is still matched (a
// missing key IS the undefined arm) and the member reads as absent.
const gone: unknown = { id: "g" };
const g = gone as Either as WithOpt;
console.log("gone", g.id, g.note === undefined ? "none" : g.note);

// The optional member provided ONLY by a getter: the match predicate saw
// nothing, so the arm was taken on the strength of the other members, and
// the accessor is what finally answers. Node reads the getter here too.
const hidden = withGetter({ id: "h" }, "note", "from-getter");
const h = hidden as Either as WithOpt;
console.log("hidden", h.id, h.note === undefined ? "none" : h.note);

// The OTHER arm, so the union really has two candidates and the walk that
// turns back on the first one is a walk that happened. The value has no
// `id`, so the first arm's REQUIRED member is what turns it back.
const numeric: unknown = { count: 7 };
const n = numeric as Either as WithNum;
console.log("numeric", n.count + 1);

// Repeated crossings of the accessor shape, so a walker that leaked the
// +1 the accessor read owes would show as growth rather than as a wrong
// answer.
let total = 0;
for (let i = 0; i < 200; i++) {
  const each = withGetter({ id: "r" }, "note", "x");
  const e = each as Either as WithOpt;
  total += (e.note === undefined ? "none" : e.note).length;
}
console.log("total", total);
