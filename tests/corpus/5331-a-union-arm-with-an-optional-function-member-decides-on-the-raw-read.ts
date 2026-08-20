// Union arms carrying FUNCTION-typed members, one REQUIRED and one
// OPTIONAL, so both halves of the merged arm walker's member rule are
// exercised in one program.
//
// A member that can hold a function is the one place where the walker
// keeps a call to the match predicate. Its VALUE comes from the binding
// read, which hands an inherited callable back BOUND to its receiver and
// therefore wearing the wrapper's signature; its DECISION has to be made
// on the RAW member, whose own signature is the one the arm asked for. An
// OPTIONAL such member adds the second half: a MISSING key is the
// undefined arm and must not be read as a miss, while a PRESENT key whose
// signature does not fit must be.
//
// Node has no arms: `as` is erased and every call below is the call the
// value's own function makes, so Node's output IS the expected output.

type NumBox = { id: string; f: (x: number) => number; g?: (x: number) => number };
type StrBox = { id: string; f: (x: number) => string; g?: (x: number) => string };
type Box = NumBox | StrBox;

const withBoth: unknown = { id: "a", f: (x: number) => x * 2, g: (x: number) => x + 1 };
const withoutG: unknown = { id: "b", f: (x: number) => x * 3 };
const strBoth: unknown = { id: "c", f: (x: number) => "s" + x, g: (x: number) => "t" + x };
const strNoG: unknown = { id: "d", f: (x: number) => "u" + x };

// Extracting the arm the value REALLY is: sound in Node (identity) and
// sound in scriptc only if the walker put the value on that arm.
const n1 = withBoth as Box as NumBox;
console.log(n1.id, n1.f(4), n1.g === undefined ? "none" : n1.g(4));

const n2 = withoutG as Box as NumBox;
console.log(n2.id, n2.f(4), n2.g === undefined ? "none" : n2.g(4));

const s1 = strBoth as Box as StrBox;
console.log(s1.id, s1.f(4), s1.g === undefined ? "none" : s1.g(4));

const s2 = strNoG as Box as StrBox;
console.log(s2.id, s2.f(4), s2.g === undefined ? "none" : s2.g(4));

// The optional member ABSENT is the undefined arm, not a miss: the arm
// still has to be taken. Repeated so a walker that rebuilt or leaked the
// bound wrapper each time would show as growth rather than a wrong answer.
let total = 0;
for (let i = 0; i < 200; i++) {
  const each: unknown = { id: "e", f: (x: number) => x + 1 };
  const b = each as Box as NumBox;
  total += b.f(i);
}
console.log("total", total);

// A value whose `f` has NEITHER arm's signature: no arm can take it. Node
// erases the cast and calls the function that is really there, so both
// outcomes are folded into one word and scriptc's message stays out of
// stdout.
const wrong: unknown = { id: "z", f: (x: number) => x > 0 };
let landed = "kept";
try {
  const bad = wrong as Box as NumBox;
  landed = "took-" + String(bad.f(1));
} catch {
  landed = "refused";
}
console.log(landed === "refused" || landed === "took-true" ? "no-silent-arm" : landed);
