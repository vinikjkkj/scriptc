// Well-known symbols as literal keys: Symbol.iterator and Symbol.asyncIterator
// print as Symbol(Symbol.iterator) and Symbol(Symbol.asyncIterator). An own
// enumerable Symbol.toStringTag does not change the prefix of a plain object.
const it = { [Symbol.iterator]: 1, q: 2 };
console.log(it);
console.log({ [Symbol.asyncIterator]: 7, r: "x" });
const tagged = { [Symbol.toStringTag]: "Tagged", v: 1 };
console.log(tagged);
console.log(Object.keys(tagged).length, tagged.v);
