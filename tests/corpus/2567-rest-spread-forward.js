// The rest-forwarding idiom — `(...args) => from(...args)` — in the
// checked-dynamic tier: a JS rest binding (a dyn array) spread-forwards
// through the runtime-arity lane (the spread-marked dynCall: one fresh
// argument array, flattened left-to-right, applied through the boxed
// thunk with JS arity). Variants: forwarding to a function declaration,
// to another closure, through a const re-binding, with leading fixed
// params, chained rest-to-rest, and mixed spread positions. Non-iterable
// spread sources throw V8's exact spread-call TypeError texts (the
// nullish form spells the spread expression; everything else the generic
// Spread-syntax text), catchably. Node is the oracle byte-for-byte.
"use strict";

function decl(a, b) {
  return a * 10 + b;
}
const clos = (a, b) => a + b;

const fDecl = (...args) => decl(...args);
const fClos = (...args) => clos(...args);
const ref = clos;
const fRef = (...args) => ref(...args);
const fLead = (x, ...rest) => decl(x, ...rest);
const fChain = (...args) => fClos(...args);
const fMixed = (...args) => decl(...args, 7);

console.log(fDecl(1, 2));
console.log(fClos(3, 4));
console.log(fRef(5, 6));
console.log(fLead(7, 8));
console.log(fChain(9, 10));
console.log(fMixed(4));

// JS arity through the runtime-arity lane: surplus dropped, missing are
// undefined.
function first(x) {
  return x;
}
const fFirst = (...args) => first(...args);
console.log(fDecl(1, 2, 3, 4));
console.log(`${fFirst()}`);

// Spread sources beyond the rest binding: strings iterate by code point,
// arrays element-by-element.
const fStr = (...args) => first(...args);
console.log(fStr(..."ab"));
console.log(fStr(...[["nested"], "tail"]));

// V8's spread-call TypeError texts, catchably, evaluation order intact.
function probe(v) {
  const g = (...args) => first(...args);
  try {
    return g(...v);
  } catch (err) {
    console.log("caught:", err.message);
    return null;
  }
}
probe(42);
probe(null);
probe(undefined);
probe({});

console.log("done");
