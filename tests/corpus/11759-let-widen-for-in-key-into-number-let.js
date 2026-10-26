// A string-initialised let written by for-in (string keys) keeps its native
// string kind, and a second string-initialised let written a number reads back
// as that number: the reads follow each stored value's own kind.
let k = '';
for (k in { alpha: 1, beta: 2 }) {
  console.log(k, typeof k, k.length);
}
console.log(typeof k, k);
let w = 'abc';
w = w.length;
console.log(w, typeof w, w + 1);
