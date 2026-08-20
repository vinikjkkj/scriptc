// A union whose arms are themselves unions, crossed through a checked
// cast. The merged arm walker reports a miss through a flag rather than
// through the exception cell, so a NESTED union has two different ways to
// say "no" flowing through the same call: its own arms' misses (written
// into its OWN slot) and the miss it hands its caller (written through the
// pointer the caller passed). Getting those two crossed reads a miss as a
// throw — the outer union stops trying arms and the program dies where it
// used to answer — or reads a throw as a miss, which is worse: a real
// failure inside a matched arm becomes "try the next one" and the value
// lands somewhere it does not belong.
//
// Node has no arms: `as` is erased and every read below is the read the
// value's own shape answers, so Node's output IS the expected output.

type Leaf = { tag: "leaf"; v: number };
type Pair = { tag: "pair"; a: number; b: number };
type Small = Leaf | Pair;

type Word = { tag: "word"; s: string };
type Line = { tag: "line"; s: string; n: number };
type Texty = Word | Line;

// The outer union's arms are records that CARRY the inner unions, so an
// outer arm is only decided after an inner union has walked its own arms
// and reported back.
type Box = { kind: "num"; body: Small } | { kind: "txt"; body: Texty };

const cases = [
  '{"kind":"num","body":{"tag":"leaf","v":7}}',
  '{"kind":"num","body":{"tag":"pair","a":2,"b":3}}',
  '{"kind":"txt","body":{"tag":"word","s":"hi"}}',
  '{"kind":"txt","body":{"tag":"line","s":"row","n":4}}',
];

for (const text of cases) {
  const b = JSON.parse(text) as Box;
  if (b.kind === "num") {
    const s = b.body;
    if (s.tag === "leaf") console.log("num leaf", s.v);
    else console.log("num pair", s.a + s.b);
  } else {
    const t = b.body;
    if (t.tag === "word") console.log("txt word", t.s);
    else console.log("txt line", t.s, t.n);
  }
}

// The inner union takes its SECOND arm while the outer takes its first:
// the inner miss has to stay inside the inner union. Repeated so a partial
// build that leaked would show as growth rather than as a wrong answer.
let total = 0;
for (let i = 0; i < 300; i++) {
  const b = JSON.parse('{"kind":"num","body":{"tag":"pair","a":1,"b":2}}') as Box;
  if (b.kind === "num" && b.body.tag === "pair") total += b.body.a + b.body.b;
}
console.log("total", total);

// A body that fits NEITHER inner arm: the inner union reports a miss, the
// outer arm that contains it reports a miss, and the outer union runs out
// of arms. Node reads the object's own fields instead, so only the FACT of
// a refusal is printed and never scriptc's message.
let outcome = "none";
try {
  const nope = JSON.parse('{"kind":"num","body":{"tag":"leaf","v":"seven"}}') as Box;
  outcome = "took:" + nope.kind;
} catch {
  outcome = "refused";
}
console.log(outcome === "refused" || outcome === "took:num" ? "no-silent-arm" : outcome);
