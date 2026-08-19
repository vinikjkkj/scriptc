// The twelve-line reduction of zapo's driver loss, and the one whose base
// answer is a WRONG ANSWER rather than a crash.
//
// TypeScript's double assertion is a relabel: the object keeps every
// member and only the static type moves. scriptc's records are closed —
// a monomorphic struct with exactly the members its shape declares — so
// the same spelling is a RESHAPE, and until the overflow grant the
// members the asserted type does not name were simply gone:
//
//   JSON.stringify(small)   node {"a":"x","b":"y"}   base {"a":"x"}
//   Object.keys(small)      node a,b                 base a
//
// Nothing threw and nothing was reported; the program was just smaller
// than it said. The destination shape is now interned with a `dyn`
// overflow portion, the reshape captures the unnamed members into it,
// and every enumeration surface answers what Node answers.
//
// Kept to the enumeration surfaces on purpose: on base this program
// COMPILES and prints the wrong answer, which is the shape a fixture has
// to have to be a regression test for a silent divergence. The round trip
// that widens back — the half that on base is a compile error, and in
// zapo's driver a runtime trap — is 4702's.
interface Small {
  a: string;
}
interface Big {
  a: string;
  b: string;
}

const big: Big = { a: "x", b: "y" };
const small = big as unknown as Small;

console.log(JSON.stringify(small));
console.log(Object.keys(small).join(","));

// A value of the same shape built ORDINARILY carries an empty overflow —
// the grant must not invent keys nobody wrote.
const plain: Small = { a: "z" };
console.log(JSON.stringify(plain));
console.log(Object.keys(plain).join(","));

// Insertion order is the source's own: JS appends the members that were
// not named after the ones that were.
interface Three {
  a: string;
  b: string;
  c: string;
}
const three: Three = { a: "1", b: "2", c: "3" };
const one = three as unknown as Small;
console.log(JSON.stringify(one));
console.log(Object.keys(one).join(","));
