// `a || b` where `a` is an optional scalar (a `let` with no initializer, a parameter) and the result is an operand of another operator
// (debug's `curr - (prevTime || curr)`): the truthy value or the default, by value (0 and "" are falsy).
function mk() {
  let prevTime;
  return function debug(curr) {
    const ms = curr - (prevTime || curr);
    prevTime = curr;
    return ms;
  };
}
const d = mk();
console.log(d(10), d(25), d(0), d(7));
let u;
const x = u || 5;
const y = (u || 0) + 1;
let s;
const t = (s || "dflt") + "!";
console.log(x, y, t);
u = 3; s = "set";
console.log((u || 9) * 2, (s || "dflt") + "!");
u = 0; s = "";
console.log((u || 9) * 2, (s || "dflt") + "!");
function opt(a) { return (a || 100) + 1; }
console.log(opt(), opt(0), opt(4));
// The same operator with a NUMBER-typed other operand and an evolving `let` (the checker types `prevTime || curr` any here).
function mk2() {
  let prevTime;
  return function debug(n) {
    const curr = Number(n);
    const ms = curr - (prevTime || curr);
    prevTime = curr;
    return ms;
  };
}
const d2 = mk2();
console.log(d2(10), d2(25), d2(0), d2(7));
