// `new Set(otherSet)` — the copy idiom, and the spelling zapo's mobile
// coordinator uses to revoke one companion key index without mutating the
// set it publishes (`const next = new Set(this.accountKeyIndexes);
// next.delete(i)`).
//
// It is `new Set([...other])` with the array literal elided, and it lowers
// to exactly that: the source drains through the same toArray the spread
// uses, and the drained array seeds the construction. The two properties
// this file pins are the ones a copy has to have — INSERTION ORDER carries
// over, and the copy is INDEPENDENT: adding to or deleting from either side
// afterwards must not be visible in the other.
//
// A ReadonlySet source is the same value at run time and the same copy;
// only the declared type differs.

const src = new Set<number>();
src.add(3);
src.add(1);
src.add(2);
src.add(1); // already present: no new position

const copy = new Set<number>(src);
console.log(copy.size);
console.log([...copy].join(","));
console.log(copy.has(1), copy.has(2), copy.has(3), copy.has(4));

// Independence, both directions.
copy.delete(1);
src.add(9);
console.log([...src].join(","));
console.log([...copy].join(","));
console.log(src.size, copy.size);

// A string set, and iteration order through forEach as well as spread.
const words = new Set<string>();
words.add("beta");
words.add("alpha");
words.add("beta");
const wordsCopy = new Set<string>(words);
const seen: string[] = [];
wordsCopy.forEach((w) => { seen.push(w); });
console.log(seen.join("|"));
console.log(wordsCopy.size);

// An EMPTY source copies to an empty set.
const none = new Set<string>();
const noneCopy = new Set<string>(none);
console.log(noneCopy.size, [...noneCopy].length);

// A ReadonlySet-typed source: the same copy, a narrower declared type.
const ro: ReadonlySet<number> = src;
const fromRo = new Set<number>(ro);
console.log(fromRo.size);
console.log([...fromRo].join(","));

// A copy of a copy, and the chain stays independent.
const second = new Set<number>(fromRo);
second.add(100);
console.log([...fromRo].join(","));
console.log([...second].join(","));

// The zapo shape: publish a new set with one index removed, leaving the
// previously published one untouched.
function without(indexes: ReadonlySet<number>, drop: number): ReadonlySet<number> {
  const next = new Set<number>(indexes);
  next.delete(drop);
  return next;
}
const published = new Set<number>([0, 1, 4]);
const revoked = without(published, 1);
console.log([...published].join(","));
console.log([...revoked].join(","));
console.log(revoked.has(1), published.has(1));

// for-of over the copy, and a fold over it.
let total = 0;
for (const n of fromRo) total += n;
console.log(total);
