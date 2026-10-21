// A module-level `const f = (x) => ...` whose parameters carry no
// annotation, READ FROM A FUNCTION DECLARATION. The binding's strict type
// `(x: any) => any` maps nowhere; it takes a func-over-dyn slot (the
// checked-dynamic fallback) so the hoisted reader has storage to bind.
// Covers const/let/var, function expressions (named too), object and
// void results, an async arrow, and the temporal dead zone: a call from a
// function before the declarator runs throws Node's ReferenceError.
// Node is the oracle byte-for-byte.
"use strict";

let counter = 0;
const fst = (x) => x;
const inc = (n) => {
  counter += n;
  return counter;
};
const mk = (a, b) => ({ a, b, sum: a + b });
const fe = function (s) {
  return s + "!";
};
const named = function nm(n) {
  return n <= 1 ? 1 : n * nm(n - 1);
};
const len = (xs) => xs.length;
var vf = (q) => q + 1;
let lf = (q) => q * 3;
const asyncArrow = async (x) => x + 1;
const noRet = (x) => {
  counter += x;
};

function probe() {
  return fst(2);
}

function useAll() {
  console.log(probe(), fst("s"), fst(null));
  console.log(inc(2), inc(3));
  console.log(mk(1, 2));
  console.log(fe("hi"), fe(5));
  console.log(named(5));
  console.log(len([1, 2, 3]), len("four"));
  console.log(vf(1), lf(2));
  noRet(4);
  console.log(counter);
  [1, 2].forEach((v) => inc(v));
  console.log(counter);
  return asyncArrow(1);
}
useAll().then((v) => console.log("async", v));

function early() {
  try {
    return later(1);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
console.log(early());
const later = (x) => x;
console.log(early());
