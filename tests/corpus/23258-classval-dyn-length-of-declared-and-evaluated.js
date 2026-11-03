// `V.length` of a class value in dyn (declared and evaluated): the own constructor's parameters before the
// first default or rest parameter; a class without a constructor of its own answers 0.
function anyv(x) { return x; }
class D0 {}
class D2 { constructor(a, b) {} }
class D3 { constructor(a, b = 1, c) {} }
class D4 extends D2 {}
class D5 { constructor(a, ...r) {} }
const mk = () => class E2 { constructor(a, b) {} };
const mk0 = () => class E0 {};
const mkd = () => class Ed { constructor(a = 1, b) {} };
const o = { D0, D2, D3, D4, D5 };
const bag = {}; bag.E2 = mk(); bag.E0 = mk0(); bag.Ed = mkd();
console.log(anyv(D0).length, anyv(D2).length, anyv(D3).length, anyv(D4).length, anyv(D5).length);
console.log(anyv(bag.E2).length, anyv(bag.E0).length, anyv(bag.Ed).length);
console.log("length" in anyv(D2), Object.hasOwn(anyv(bag.E2), "length"));
