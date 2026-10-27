// Clone of a dyn-held class instance, then independent mutation and methods.
class Box {
  constructor(v) {
    this.v = v;
    this.tag = "t" + v;
  }
  twice() {
    return this.v * 2;
  }
  mark(k, val) {
    Object.defineProperty(this, k, { value: val, enumerable: true, writable: true, configurable: true });
  }
}
function holder(x) {
  return x;
}
const src = holder(new Box(7));
src.mark("label", "L");
const dup = Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
console.log(dup instanceof Box, dup.twice(), dup.label);
dup.v = 8;
console.log(src.v, dup.v, src.twice(), dup.twice());
dup.label = "M";
console.log(src.label, dup.label);
