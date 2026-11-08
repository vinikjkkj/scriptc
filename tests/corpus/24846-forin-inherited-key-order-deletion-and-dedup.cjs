// per-level order of inherited keys: array indices ascending, then strings in insertion order, nearer level first
function A() {}
A.prototype.zed = "z";
A.prototype[10] = "ten";
A.prototype.apple = "a";
A.prototype[2] = "two";
function B() { this.q = 1; this[7] = "own7"; this.r = 2; }
B.prototype = Object.create(A.prototype);
B.prototype.mid = "m";
B.prototype[5] = "five";
const b = new B();
b[1] = "own1";
const order = [];
for (const k in b) order.push(k);
console.log(order.join(","));
// a key deleted from the prototype before its turn is skipped; one added during the loop is not visited
const seen = [];
for (const k in b) {
  seen.push(k);
  if (k === "q") { delete A.prototype.apple; A.prototype.late = "l"; }
}
console.log(seen.join(","));
// an own key that also exists on the prototype is visited once
function C() { this.dup = "own"; }
C.prototype.dup = "proto";
C.prototype.only = "proto";
const c = new C();
const cs = [];
for (const k in c) cs.push(k + "=" + c[k]);
console.log(cs.join(" "));
