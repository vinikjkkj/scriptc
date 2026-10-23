// reduce, reduceRight, findLast, findLastIndex, toReversed, toSorted and
// with on a receiver the compiler cannot type. They were refused at build
// by name (SC1090) in the dotted spelling and a loud "not supported yet"
// in the computed one, while every array and typed array has them. The
// names now dispatch on the receiver's run-time kind like `map` does: an
// array runs the real method, a typed array runs its own, an object calls
// its own member of that name, and every other kind answers Node's "is not
// a function".
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

function arr(a) {
  T("reduce", () => a.reduce((x, y) => x + y, 0));
  T("reduce strings", () => a.reduce((x, y) => x + "," + y));
  T("reduce no init", () => a.reduce((x, y) => x + y));
  T("reduce index and array", () => a.reduce((acc, v, i, all) => acc + i + (all === a ? "=" : "!"), ""));
  T("reduce init undefined", () => a.reduce((x, y) => String(x) + y, undefined));
  T("reduceRight", () => a.reduceRight((x, y) => x + "-" + y));
  T("reduceRight init", () => a.reduceRight((x, y, i) => x + i, ""));
  T("reduce bad callback", () => a.reduce(5));
  T("reduce undefined callback", () => a.reduce());
  T("findLast", () => a.findLast((v) => v % 2 === 1));
  T("findLast none", () => a.findLast((v) => v > 99));
  T("findLastIndex", () => a.findLastIndex((v) => v % 2 === 1));
  T("findLastIndex none", () => a.findLastIndex((v) => v > 99));
  T("findLast index argument", () => a.findLast((v, i) => i === 1));
  T("findLast thisArg", () => a.findLast(function (v) { return v === this.want; }, { want: 4 }));
  T("findLast bad callback", () => a.findLast("x"));
  T("toReversed", () => a.toReversed());
  T("toReversed copies", () => { const r = a.toReversed(); r[0] = 99; return a; });
  T("toSorted", () => a.toSorted());
  T("toSorted comparator", () => a.toSorted((p, q) => q - p));
  T("toSorted copies", () => { const r = a.toSorted(); r[0] = 99; return a; });
  T("toSorted bad comparator", () => a.toSorted(5));
  T("toSorted object comparator", () => a.toSorted({}));
  T("toSorted null comparator", () => a.toSorted(null));
  T("with", () => a.with(0, 99));
  T("with negative", () => a.with(-1, 99));
  T("with fraction", () => a.with(1.9, 4));
  T("with string index", () => a.with("1", 4));
  T("with NaN", () => a.with(NaN, 4));
  T("with no value", () => a.with(1));
  T("with out of range", () => a.with(9, 1));
  T("with negative out of range", () => a.with(-9, 1));
  T("with infinity", () => a.with(Infinity, 1));
  T("with copies", () => { const r = a.with(0, 99); return a; });
}
arr(id([3, 1, 4, 1, 5]));
arr(id([]));

// the default sort orders by string image, undefined last
T("toSorted default", () => id([10, 9, 1, undefined, "b", "a", null]).toSorted());
T("toSorted of strings", () => id(["pear", "apple", "fig"]).toSorted());
T("reduce over objects", () => id([{ n: 1 }, { n: 2 }]).reduce((s, o) => s + o.n, 0));
T("reduce nested", () => id([[1, 2], [3]]).reduce((s, a) => s.concat(a), []));
T("with an array value", () => id([1, 2]).with(0, [9]));

// other kinds: an object calls its own member, the rest are not functions
const own = id({ reduce(f, i) { return "own reduce " + typeof f + i; }, with(i) { return "own with " + i; }, toSorted() { return "own toSorted"; } });
T("own reduce", () => own.reduce(() => 1, 5));
T("own with", () => own.with(3));
T("own toSorted", () => own.toSorted());
const po = id({});
T("plain object", () => po.reduce(() => 1));
const st = id("abc");
T("string", () => st.reduce(() => 1));
T("string with", () => st.with(0, "x"));
const nu = id(5);
T("number", () => nu.findLast(() => 1));
const bo = id(true);
T("boolean", () => bo.toReversed());
const nl = id(null);
T("null", () => nl.with(0, 1));
const un = id(undefined);
T("undefined", () => un.reduce(() => 1));
const fu = id(function f() {});
T("function", () => fu.toSorted());
const mp = id(new Map());
T("map", () => mp.reduce(() => 1));

// the computed spelling reaches the same dispatch
function by(x, name, a, b) { return x[name](a, b); }
T("computed reduce", () => by(id([1, 2, 3]), "reduce", (p, q) => p + q, 10));
T("computed findLast", () => by(id([1, 2, 3]), "findLast", (v) => v < 3));
T("computed with", () => by(id([1, 2, 3]), "with", 1, 7));
T("computed toSorted on a typed array", () => by(id(new Uint8Array([3, 1, 2])), "toSorted").join());
