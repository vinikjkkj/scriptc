class C {
  static fm() { if (!this.flagMap) { this.flagMap = { a: 1 }; } return this.flagMap; }
  static chk(k) { return !!this.fm()[k]; }
  static bump() { this.count = this.count + 1; return this.count; }
  static viaArrow() { return [1, 2].map((x) => this.count + x); }
}
C.count = 0;
console.log(C.chk("a"), C.chk("b"), C.bump(), C.bump(), C.viaArrow().join(","));
