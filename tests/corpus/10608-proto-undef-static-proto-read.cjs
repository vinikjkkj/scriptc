// C.prototype.name read on the class itself, both before and after an instance writes its own value.
class K {
  constructor() { this.z = 1; }
  put() { this.slot = "own"; }
}
K.prototype.slot = undefined;
console.log(K.prototype.slot);
const k = new K();
k.put();
console.log(K.prototype.slot, k.slot);
