// A DATA property that every literal in the program fills with a getter.
//
// A shape is interned from the TYPE, long before any producer is seen, so
// a field can only carry an accessor slot if the decision is made over the
// whole program. Two values of one interface must share a layout: if any
// producer needs the slot, the field has it.
//
// The reason it matters is liveness. `get store() { return current }` over
// a binding that gets REASSIGNED cannot be frozen into a data slot -- the
// live getter starts returning the new object and the frozen field does
// not. Before this the whole literal fenced; now the field holds the
// getter and reads go through it.
//
// Narrowed on purpose: a property some literal fills with plain DATA keeps
// the old fence, because that literal would have nothing to put in the
// slot. The layout only changes when every producer agrees.
interface Bundle {
  readonly store: { n: number };
  readonly label: string;
}

let current = { n: 1 };

const first: Bundle = {
  label: "first",
  get store() {
    return current;
  },
};

const second: Bundle = {
  label: "second",
  get store() {
    return current;
  },
};

// Reassigning the base is what a reset does. Both bundles must follow it.
current = { n: 42 };
console.log(first.label, first.store.n);
console.log(second.label, second.store.n);

// Mutation through the current object is visible too.
current.n += 1;
console.log(first.store.n, second.store.n, first.store === second.store);

// Crossing a call boundary, where the slot has to dispatch the same way.
function read(b: Bundle): string {
  return `${b.label}:${b.store.n}`;
}
console.log(read(first), read(second));

// A third reassignment after the reads, to show nothing was cached.
current = { n: 7 };
console.log(read(first), read(second));

// `label` stays an ordinary data field -- only the getter-filled property
// takes a slot.
console.log(first.label.toUpperCase(), second.label.length);
