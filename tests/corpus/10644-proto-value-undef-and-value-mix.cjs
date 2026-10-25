// One name is undefined-only on one class and a value on another class: the two stay separate.
class U1 {
  constructor() { this.u = 1; }
  setN() { this.nn = 'uu'; }
}
class V1 {
  constructor() { this.v = 1; }
}
U1.prototype.nn = undefined;
V1.prototype.nn = 'vv';
const u = new U1();
const v = new V1();
console.log(u.nn, v.nn);
u.setN();
console.log(u.nn, v.nn);
