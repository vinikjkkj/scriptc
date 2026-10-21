// A curried closure stored into a slot whose RETURN is a wider function type
// (the mysql2 auth-plugin shape). Every level converts exactly: the returned
// closure takes the slot's union return, fewer parameters than the slot are
// fine (JS drops extras), and the depth is not special-cased.
type Plug = (m: { command: string }) => (d: string) => string | null;
const table: { [k: string]: Plug } = {
  a: (m) => (d) => m.command + d,
  b: () => () => null,
};
for (const n of ["a", "b"]) {
  const r = table[n]!({ command: "go" })("x");
  console.log(n, r === null ? "null" : r);
}

// fewer INNER parameters than the slot
type Inner2 = (m: number) => (d: number, e: string) => string | null;
const fewerInner: Inner2 = (m) => (d) => "r" + (m + d);
console.log(fewerInner(1)(2, "ignored"));

// fewer OUTER parameters than the slot
type Outer2 = (m: number, x: string) => (d: number) => string | null;
const fewerOuter: { [k: string]: Outer2 } = {
  a: () => (d) => "r" + d,
  b: (m) => (d) => (d > 5 ? null : "s" + m + d),
};
console.log(fewerOuter["a"]!(1, "q")(2), fewerOuter["b"]!(1, "q")(9), fewerOuter["b"]!(1, "q")(3));

// three and four levels
type P3 = (a: number) => (b: number) => (c: number) => string | null;
const three: { [k: string]: P3 } = {
  a: (a) => (b) => (c) => "r" + (a + b + c),
  b: () => () => () => null,
};
console.log(three["a"]!(1)(2)(3), three["b"]!(1)(2)(3));
type P4 = (a: number) => (b: number) => (c: number) => (d: number) => number | undefined;
const four: P4 = (a) => (b) => (c) => (d) => a + b + c + d;
console.log(four(1)(2)(3)(4));

// a named factory, not an inline arrow
function make(o: { n: number }) {
  return (d: string): string => d + o.n;
}
const viaNamed: (o: { n: number }) => (d: string) => string | null = make;
console.log(viaNamed({ n: 3 })("z"));
