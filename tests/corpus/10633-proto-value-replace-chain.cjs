// Reassigning the prototype datum between reads, with instances created in between.
class Ver {
  constructor(i) { this.i = i; }
}
Ver.prototype.version = 1;
const v1 = new Ver(1);
console.log(v1.version);
Ver.prototype.version = 2;
const v2 = new Ver(2);
console.log(v1.version, v2.version);
Ver.prototype.version = 3;
console.log(v1.version + v2.version);
