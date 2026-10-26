// The static receiver is Base; the walked instance is whichever subclass was
// constructed, so the key list follows the RUNTIME class (deepest first).
class Base {
  x = 1;
  y = 2;
  keys() {
    const ks = [];
    for (const k in this) ks.push(k);
    return ks.join(',');
  }
}
class Mid extends Base {
  z = 3;
}
class Leaf extends Mid {
  w = 4;
  x2 = 5;
}
console.log(new Base().keys());
console.log(new Mid().keys());
console.log(new Leaf().keys());
const all = [new Base(), new Leaf(), new Mid(), new Base()];
for (const o of all) console.log(o.keys());
