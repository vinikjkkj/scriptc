// `new Array<T>(n)` with SCALAR elements, when a counting loop writes every
// index. Scalars have no absent value that isn't a lie on read -- their slot
// would answer 0/false where Node answers undefined -- so the node is built
// for them only where every slot is provably written first. That is the same
// argument the `.fill(v)` exception already makes, written as a loop.
//
// The proof is syntactic and complete: the loop runs 0..n-1 by ones over the
// SAME length expression, the body assigns a[i] at its top level so no branch
// can skip it, the body mentions the array nowhere else, and it contains no
// break/continue/return that could leave the tail unwritten. Anything outside
// that declines and keeps the fence -- verified separately, since a corpus
// case can only hold programs that compile.
const table = new Array<number>(8);
for (let i = 0; i < 8; i += 1) {
  let c = i;
  c = c * 3 + 1;
  table[i] = c;
}
console.log(table.join(","), table.length);

// A computed length, `i++`, and a single-statement body.
const src = ["a", "bb", "ccc"];
const lens = new Array<number>(src.length);
for (let i = 0; i < src.length; i++) lens[i] = src[i]!.length;
console.log(lens.join(","), lens.length);

// Booleans take their own zero.
const flags = new Array<boolean>(4);
for (let i = 0; i < 4; i += 1) flags[i] = i % 2 === 0;
console.log(flags.join(","));

// A zero-length array is still the empty array, not a hole.
const none = new Array<number>(0);
for (let i = 0; i < 0; i += 1) none[i] = i;
console.log(none.length, JSON.stringify(none));

// The refcounted spellings that already worked, kept as the control.
const names = new Array<string>(3);
for (let i = 0; i < 3; i += 1) names[i] = `n${i}`;
console.log(names.join(","));

const filled = new Array<string>(3).fill("x");
console.log(filled.join(","));
