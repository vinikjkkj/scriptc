// A JS class whose declared fields are written in a different order by the
// constructor: Node creates the declared fields at construction, in
// declaration order, so Object.keys lists them a, b, c regardless of writes.
class Base {
  x;
  y;
  constructor() {
    this.y = 1;
    this.x = 2;
  }
}

class Derived extends Base {
  p;
  q;
  constructor() {
    super();
    this.q = 3;
    this.p = 4;
  }
}

class Plain {
  a;
  b;
  constructor() {
    this.b = 'B';
    this.a = 'A';
  }
}

console.log(Object.keys(new Plain()).join(','));
console.log(Object.keys(new Base()).join(','));
console.log(Object.keys(new Derived()).join(','));
const d = new Derived();
console.log(d.x, d.y, d.p, d.q);
