// `bound.name` is "bound " plus the target's name, stacking on a rebind, and
// "bound " alone for an anonymous target. `length` is the target's minus the
// bound argument count, floored at zero. A bound function over an untyped field
// (the mysql2 command shape) answers the same, and so does one that comes back
// out of a method.

function named(a, b) {
  return a + b;
}

const b1 = named.bind(null, 1);
console.log(b1.name, b1.length);

const b2 = b1.bind(null);
console.log(b2.name, b2.length);
console.log(b2(2));

const anon = function () {
  return 0;
};
const b3 = anon.bind(null);
console.log(JSON.stringify(b3.name), b3.length);

class Holder {
  constructor(f) {
    this.f = f;
  }
  get() {
    return this.f.bind(null, 5);
  }
}
const h = new Holder(named);
const got = h.get();
console.log(got.name, got.length, got(6));

const over = new Holder(function (x, y, z) {
  return x + y + z;
});
console.log(over.get().name, over.get().length);
