// A computed key that is a property read of a const table of literals folds to the literal, so a table keyed that way is an
// ordinary object literal: read from functions, chosen between, spread with another computed key, and walked in key order.
const T = { A: 1, B: 2, C: 3 };
const U = { NAMES: { X: "x", Y: "y" } };
const legacy = { [T.A]: Array, [T.B]: Number, [T.C]: String };
const resp3 = { [T.A]: Array, [T.B]: Map };
const names = { [U.NAMES.X]: 1, [U.NAMES.Y]: 2 };
function pick(o) {
  const base = o.reply === "resp3" ? resp3 : legacy;
  return o.str ? { ...base, [T.C]: String } : base;
}
const a = pick({ reply: "resp3" });
const b = pick({ str: true });
const c = pick({ reply: "resp3", str: true });
console.log(Object.keys(a).join(","), a[1] === Array, a[2] === Map, a[3]);
console.log(Object.keys(b).join(","), b[2] === Number, b[3] === String);
console.log(Object.keys(c).join(","), c[2] === Map, c[3] === String);
console.log(Object.keys(names).join(","), names.x, names.y, JSON.stringify(names));
function lookup(k) { return legacy[k] === Array; }
console.log(lookup(1), lookup(2), lookup(3));
