// flat and toSpliced on a receiver the compiler cannot type. Both were
// refused at build by name (SC1090) in the dotted spelling and a loud
// "not supported yet" in the computed one, while every array has them.
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

function arr(a, nested) {
  T("flat", () => a.flat());
  T("flat 0", () => a.flat(0));
  T("flat -1", () => a.flat(-1));
  T("flat NaN", () => a.flat(NaN));
  T("flat undefined", () => a.flat(undefined));
  T("flat 2.9", () => a.flat(2.9));
  T("flat string depth", () => a.flat("2"));
  T("flat Infinity", () => nested.flat(Infinity));
  T("flat 1 nested", () => nested.flat(1));
  T("flat 2 nested", () => nested.flat(2));
  T("flat fresh array", () => a.flat() !== a);
  T("flat computed", () => a["flat"](1));
  T("toSpliced none", () => a.toSpliced());
  T("toSpliced start", () => a.toSpliced(1));
  T("toSpliced delete", () => a.toSpliced(1, 1));
  T("toSpliced insert", () => a.toSpliced(1, 0, "x", "y"));
  T("toSpliced negative", () => a.toSpliced(-1, 1, "z"));
  T("toSpliced past end", () => a.toSpliced(99, 5, "e"));
  T("toSpliced negative count", () => a.toSpliced(0, -3));
  T("toSpliced leaves receiver", () => { const c = a.toSpliced(0, 2); return [c.length, a.length]; });
  T("toSpliced computed", () => a["toSpliced"](0, 1));
}

arr(id(JSON.parse("[1,[2,3],[4,[5]],6]")), id(JSON.parse("[1,[2,[3,[4,[5]]]]]")));
arr(id([1, 2, 3]), id([[1], [[2]]]));

function other(v) {
  T("flat on string", () => v.flat());
  T("toSpliced on string", () => v.toSpliced(0, 1));
}
other(id("abc"));
other(id(42));
other(id({ flat() { return "own"; }, toSpliced() { return "own2"; } }));
other(id(new Uint8Array([3, 4])));
other(id(null === 1 ? 0 : { }));
