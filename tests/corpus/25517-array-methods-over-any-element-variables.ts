// Array methods over an array variable initialised from a literal of any-typed values: callbacks, searches and reductions take the dyn path.
const n: any = 5;
const o: any = { a: 1 };
const s: any = "q";
const list = [n, o, s, 2];
console.log(list.map((x) => typeof x));
console.log(list.filter((x) => x !== 5));
console.log(list.reduce((acc, x) => acc + (typeof x === "number" ? x : 0), 0));
console.log(list.find((x) => typeof x === "string"), list.findIndex((x) => x === 2));
console.log(list.some((x) => x === 5), list.every((x) => x !== null), list.indexOf(n), list.includes(2));
list.forEach((x, i) => console.log(i, x));
console.log(list.slice(1, 3), list.join("-"), list.at(-1), list.length);
list.push("pushed");
console.log(list.map(String));
let l2 = [n];
l2 = [o, s];
console.log(l2.map((x) => typeof x), l2.filter((x) => typeof x === "object"));
// A literal consumed in place as a method receiver.
console.log([...list].reverse(), [n, o].map((x) => typeof x), [n, s].length);
