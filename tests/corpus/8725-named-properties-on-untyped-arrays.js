// Named properties on an array reached through a receiver the compiler
// cannot type. `a.tag = "x"` on a dynamic array threw "Cannot create
// property 'tag' on array" where Node stores it, so an array could not
// carry the extras Node's own results do (an exec match's index, input and
// groups). The array now keeps its own enumerable named properties beside
// its elements: they read back, enumerate after the indices, answer `in`
// and hasOwnProperty, delete, survive a truncation, are ignored by JSON,
// slice and map, travel through structuredClone, and print after the
// elements the way util.inspect prints them.
'use strict';

function T(name, f) {
  try {
    const r = f();
    console.log(name, typeof r, r !== null && typeof r === "object" ? JSON.stringify(r) : String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.message);
  }
}
function id(v) { return v; }

function expando(a) {
  a.tag = "t";
  a.index = 7;
  T("expando", () => a.tag + a.index);
  T("expando keys", () => Object.keys(a).join());
  T("expando in", () => "tag" in a);
  T("delete", () => delete a.tag);
  T("after delete", () => typeof a.tag + Object.keys(a).join());
  a.length = 1;
  T("truncate keeps the properties", () => a.index + ":" + a.length);
  T("JSON ignores them", () => JSON.stringify(a));
  T("clone keeps them", () => { const c = structuredClone(a); return c.index + ":" + Object.keys(c).join(); });
}
expando(id([1, 2, 3]));


function more(a) {
  a.nested = { n: [1, 2] };
  a.undef = undefined;
  a["not an identifier"] = 1;
  T("object values", () => Object.values(a).length);
  T("object entries", () => Object.entries(a).map((e) => e[0]).join("|"));
  T("own undefined", () => a.hasOwnProperty("undef") + "," + ("undef" in a) + "," + typeof a.undef);
  T("odd key", () => a["not an identifier"]);
  T("overwrite", () => { a.nested = 5; return a.nested; });
  T("slice", () => Object.keys(a.slice(0)).join());
  T("map", () => Object.keys(a.map((x) => x)).join());
  T("concat", () => Object.keys(a.concat([9])).join());
}
more(id([1, 2]));

// printing: the extras follow the elements
const p = id([1, 2, 3]);
p.tag = "t";
p.n = 5;
console.log(p);
const e = id([]);
e.only = 1;
console.log(e);
console.log([p]);
console.log({ p });
const tall = id([]);
for (let i = 0; i < 8; i++) tall.push(i * 100);
tall.k = "x";
console.log(tall);
const nested = id([[1, 2]]);
nested[0].inner = true;
console.log(nested);
