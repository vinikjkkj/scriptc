// Array map/filter/forEach handed an implicit-any function BY REFERENCE (a
// function declaration or an unannotated arrow const). The callback's
// parameter is checked-dynamic and its result is too, so map answers the
// checked-dynamic array; primitive elements cross by value. Node is the oracle.
function inc(q) { return q + 1; }
const dbl = (q) => q * 2;
const label = (v, i) => v + ":" + i;
function big(q) { return q > 2; }
const seen = [];
function note(q) { seen.push(q); }

console.log([1, 2, 3].map(inc));
console.log([1, 2, 3].map(dbl), ["a", "bb"].map(dbl));
console.log(["x", "y"].map(label));
console.log([1, 2, 3, 4].filter(big));
[5, 6].forEach(note);
console.log(seen);
console.log([1, 2, 3].map((x) => dbl(x)).length);
const r = [10, 20].map(inc);
console.log(r[0] + r[1], Array.isArray(r), typeof r);
