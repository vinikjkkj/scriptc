// A union of object literals with disjoint fields: TypeScript gives each arm
// the other arms' members as `?: undefined`, the compiler merges the arms
// into one record, and the absent members used to print as present
// `undefined` (`{ a: undefined, c: 3 }` where Node prints `{ c: 3 }`).
// Every own-key surface has to say the same thing about the same value.
interface AC {
  a?: number;
  c?: number;
}
const n = process.argv.length;
const yes = n > 99;
const no = !yes;

const x = yes ? { a: 1 } : { c: 3 };
const y = no ? { a: 1 } : { c: 3 };
console.log(x);
console.log(y);
console.log(JSON.stringify(x), JSON.stringify(y));
console.log("a" in x, "c" in x, "a" in y, "c" in y);

const rest = (label: string, v: AC): void => {
  console.log(label, v, Object.keys(v), Object.values(v), Object.entries(v));
  console.log(label, Object.hasOwn(v, "a"), Object.hasOwn(v, "c"), { ...v });
  const seen: string[] = [];
  for (const k in v) seen.push(k);
  console.log(label, seen);
};
rest("x", x);
rest("y", y);

// three arms, one with two members
const t = (k: number) => (k === 0 ? { a: 1 } : k === 1 ? { b: "two", c: true } : { c: false });
for (let k = 0; k < 3; k++) {
  const v = t(k);
  console.log(v, "b" in v, JSON.stringify(v));
}

// nested literals and an array of the union
const nested = yes ? { inner: { p: 1 } } : { inner: { q: 2 }, tag: "t" };
console.log(nested);
const list = [yes ? { a: 1 } : { c: 3 }, no ? { a: 1 } : { c: 3 }, { a: 7, c: 9 }];
console.log(list);
console.log(JSON.stringify(list));
console.log(list.map((e) => JSON.stringify(e).length));
