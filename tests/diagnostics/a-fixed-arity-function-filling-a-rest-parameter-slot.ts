// The two rest-slot pairs the function-value adapter cannot express, and
// which used to compile into a SILENT wrong answer.
//
// tests/corpus/7500 pins everything that works. A function written with a
// REST parameter, filling a slot of FIXED arity, PACKS: the slot's
// arguments become the array the callee's rest slot is. The mirror —
// a fixed-arity function filling a VARIADIC slot — UNPACKS: the slot's
// callers hand one packed array and the wrapper reads element `i` for
// parameter `i` through the keyed-dyn path, which answers the undefined
// dyn value for a missing index, exactly what Node binds to a parameter
// the call never reached. Both of those are correct now.
//
// Neither works here, and for two different reasons.
//
// A — a TYPED pack. `...args: string[]` is a real array, not the
// checked-dynamic one, and an out-of-range read on it TRAPS where Node
// hands back undefined. The wrapper would have to invent an arity test
// with no honest failure mode, so the pair refuses instead. It used to
// hand the whole pack over as argument ZERO: `a('x', 'y')` bound `first`
// to the array's toString, "x,y".
//
// B — BOTH sides packed, at different signatures. The wrapper would have
// to unpack the slot's array and repack it into the callee's, and the two
// element types are exactly what makes the repack unrepresentable — this
// is A's problem with an extra hop. It used to bind the slot's whole pack
// as the callee's FIRST rest element, so a one-argument call arrived as
// `args.length === 1` holding an array.
//
// The printed types are what makes either message actionable: a spelled
// rest slot prints as `...T`, so the two sides no longer read identically
// (they both printed `(string) => void` before, and named nothing).

type Slot = (...args: string[]) => void;

// A — the arrow.
const a: Slot = (first: string): void => {
  console.log(first);
};

// A again, through an object literal's field, so the record-projection
// path takes the refusal too rather than width-lifting a copy that calls
// the packed slot positionally.
interface Sink {
  emit(...args: string[]): void;
}
const c: Sink = {
  emit: (first: string): void => {
    console.log(first);
  },
};

// B — a rest source into a rest slot of a different element type.
interface Wide {
  emit(...args: unknown[]): void;
}
const w: Wide = {
  emit: (...args: string[]): void => {
    console.log(String(args.length));
  },
};

a("x", "y");
c.emit("x", "y");
w.emit("x");
