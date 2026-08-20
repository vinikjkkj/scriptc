// ARRAY, TUPLE and INDEX-SIGNATURE arms, each of which fits at the top of
// its union and turns back partway down.
//
// The merged arm walker builds while it decides, so each of these three
// composites owns a DIFFERENT cleanup on the way back: an array releases
// the ScrArr it has been pushing into, a tuple releases the record it has
// been filling, and an index-signature record releases the record AND the
// overflow map that captured the undeclared keys. The matcher that used to
// decide these arms allocated nothing at all, so none of those paths
// existed before and every one of them is new code. A release that never
// happens is invisible in the answer and shows only under the RC audit; a
// release that happens twice, or of the wrong thing, shows here.
//
// Node has no arms: `as` is erased and every read below is the read the
// value's own shape answers, so Node's output IS the expected output.

// ── the ARRAY arm: fits `xs`, fits two elements, turns back on the third
type Nums = { xs: number[] };
type Strs = { xs: string[] };
type Many = Nums | Strs;

function manyStr(text: string): string {
  const s = JSON.parse(text) as Many as Strs;
  return "str " + String(s.xs.length) + ":" + s.xs[2];
}
function manyNum(text: string): string {
  const n = JSON.parse(text) as Many as Nums;
  return "num " + String(n.xs.length) + ":" + String(n.xs[1]);
}

console.log(manyStr('{"xs":["p","q","r"]}'));
console.log(manyNum('{"xs":[1,2,3,4]}'));

// ── the TUPLE arm: the arity is checked before a single element is built,
//    and the ELEMENT types after the first one is
type P2 = { xy: [number, string] };
type P3 = { xy: [number, string, boolean] };
type Pair = P2 | P3;

function pair2(text: string): string {
  const p = JSON.parse(text) as Pair as P2;
  return "two " + String(p.xy[0]) + p.xy[1];
}
function pair3(text: string): string {
  const p = JSON.parse(text) as Pair as P3;
  return "three " + String(p.xy[0]) + p.xy[1] + String(p.xy[2]);
}

console.log(pair2('{"xy":[3,"z"]}'));
console.log(pair3('{"xy":[4,"w",true]}'));

// ── the INDEX-SIGNATURE arm: the declared key decides, the undeclared
//    ones are captured into the overflow map as the walk goes
type SBag = { tag: string; [k: string]: string };
type NBag = { n: number; [k: string]: number };
type Bag = SBag | NBag;

function sbag(text: string): string {
  const s = JSON.parse(text) as Bag as SBag;
  return "bag " + s["tag"] + "/" + String(s["a"]) + String(s["b"]);
}

console.log(sbag('{"tag":"t","a":"A","b":"B"}'));

// The same crossings repeated, so a release that never happens shows as
// growth and a release that happens twice shows as a crash.
let total = 0;
for (let i = 0; i < 250; i++) {
  total += manyStr('{"xs":["p","q","r"]}').length;
  total += pair2('{"xy":[1,"a"]}').length;
  total += sbag('{"tag":"t","a":"A","b":"B"}').length;
}
console.log("total", total);

// A tuple of an arity NEITHER arm has: the refusal that happens before a
// single element is built. Node reads the array's own elements instead, so
// both outcomes are folded into one word and scriptc's message stays out
// of stdout.
let landed = "kept";
try {
  const bad = JSON.parse('{"xy":[1,"a",true,9]}') as Pair as P2;
  landed = "took-" + String(bad.xy[0]);
} catch {
  landed = "refused";
}
console.log(landed === "refused" || landed === "took-1" ? "no-silent-arm" : landed);
