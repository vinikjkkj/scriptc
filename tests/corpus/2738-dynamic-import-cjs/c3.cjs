class K {
  constructor(v) { this.v = v === undefined ? 3 : v; }
  get() { return this.v; }
  twice() { return this.get() * 2; }
  static make(n) { return new K(n); }
  static get kind() { return "K-kind"; }
}
module.exports = K;
console.log("cjs3");
