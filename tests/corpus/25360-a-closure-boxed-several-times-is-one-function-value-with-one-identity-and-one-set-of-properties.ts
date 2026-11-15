// A function value that crosses into a dyn slot several times is ONE JavaScript function: === holds between every box of it, indexOf/includes
// find it through any box, own properties written through one are read through another, and two closures
// made by the same function are never ===. Also what util.inspect, String() and JSON.stringify say about boxed functions, and name/length.
const slotA: any[] = [];
const slotB: any[] = [];
const slotC: any[] = [];

function makeCounter(start: number): () => number {
  let n = start;
  return () => {
    n += 1;
    return n;
  };
}

function boxThrice(f: () => number): void {
  slotA.push(f);
  slotB.push(f);
  slotC.push(f);
}

const c1 = makeCounter(0);
const c2 = makeCounter(100);
boxThrice(c1);
boxThrice(c2);

// identity: the same closure boxed three times is ===, two closures of one function are not
console.log("same closure, three boxes", slotA[0] === slotB[0] && slotB[0] === slotC[0]);
console.log("two closures of one function", slotA[0] === slotA[1], slotA[0] !== slotA[1]);

// the boxes share ONE closure: a call through one is visible through another
console.log("calls", slotA[0](), slotB[0](), slotC[0](), c1());

// membership: a set of distinct functions built by === over the boxes holds two members whichever box of a closure is offered
const members: any[] = [];
for (let i = 0; i < 4; i++) {
  const box: any = i === 0 ? slotA[0] : i === 1 ? slotB[0] : i === 2 ? slotC[0] : slotA[1];
  if (!members.includes(box)) members.push(box);
}
console.log("distinct members", members.length, members.includes(slotC[0]), members.includes(slotB[1]));
console.log("indexOf / includes", slotA.indexOf(slotC[1]), slotB.includes(slotA[0]));

// own properties live on the function, not on a box
slotA[0].tag = "from A";
slotB[1].tag = "from B";
console.log("props", slotC[0].tag, slotC[1].tag, slotA[1].tag);

// name and length
function named(a: number, b: number): number {
  return a + b;
}
const boxedNamed: any = named;
const boxedNamedAgain: any = named;
console.log("name/length", boxedNamed.name, boxedNamed.length, boxedNamed === boxedNamedAgain);

// typeof, String, JSON
console.log("typeof", typeof slotA[0], typeof boxedNamed);
const bag: any[] = [];
bag.push(slotA[0]);
bag.push(boxedNamed);
bag.push(1);
console.log("json", JSON.stringify(bag));
console.log("direct call", boxedNamed(2, 3) + 0);
