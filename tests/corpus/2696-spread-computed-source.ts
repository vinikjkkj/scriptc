// Spreading a COMPUTED source: `{ ...makeBase(node), kind: 'msg' }`, the
// shape an event factory is written in.
//
// The field copies re-emit the source once per field they take from it, so
// a call source would run once per copied field. It is evaluated ONCE into
// a hidden slot instead, and the copies read the slot -- the `calls`
// counters below are what prove it, and they have to agree with Node.
//
// The slot is filled ahead of every field, which moves the source's
// evaluation ahead of earlier contributors. That is unobservable only
// while those are pure, so the hoist stops at the first impure one and the
// fence stands after it: reordering two effects is a wrong answer, not a
// missing feature.
type Base = { readonly id: string; readonly at: number };

let calls = 0;
function makeBase(tag: string): Base {
  calls += 1;
  return { id: `${tag}#${calls}`, at: calls };
}

// One spread of a call, with a later explicit field.
const one = { ...makeBase("a"), kind: "msg" };
console.log(one.id, one.at, one.kind, calls);

// TWO computed spreads: each runs once, in source order, and the later one
// wins the fields they share (JS last-write-wins).
const two = { ...makeBase("b"), ...makeBase("c") };
console.log(two.id, two.at, calls);

// A spread whose source is an AWAIT -- the same hoist, across a suspension.
async function fetchBase(tag: string): Promise<Base> {
  calls += 1;
  return { id: `${tag}#${calls}`, at: calls };
}

async function main(): Promise<void> {
  const three = { ...(await fetchBase("d")), kind: "async" };
  console.log(three.id, three.at, three.kind, calls);

  // An indexed read is computed too (the element access is re-emitted per
  // field otherwise).
  const table: readonly Base[] = [
    { id: "t0", at: 100 },
    { id: "t1", at: 101 },
  ];
  let idx = 0;
  function pick(): number {
    idx += 1;
    return idx - 1;
  }
  const four = { ...table[pick()], kind: "indexed" };
  console.log(four.id, four.at, four.kind, idx);

  // Overriding a spread field explicitly still reads the single slot.
  const five = { ...makeBase("e"), at: -1 };
  console.log(five.id, five.at, calls);
}

void main();
