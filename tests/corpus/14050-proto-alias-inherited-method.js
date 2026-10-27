// C.prototype.m = D.prototype.n where n is INHERITED by D (declared on an
// ancestor of D). Node installs a new own method m on C that runs the
// ancestor's body with this = the C instance; subclasses of C see it too.
class Base {
  constructor(v) {
    this.v = v;
  }
  describe(p) {
    return p + ":" + this.v;
  }
}
class Mid extends Base {}
class Conn extends Mid {
  constructor(v) {
    super(v);
    this.tag = "conn";
  }
}
class Pool extends Conn {}

Pool.prototype.show = Conn.prototype.describe;
Conn.prototype.sum = Base.prototype.describe;

const p = new Pool(7);
console.log(p.show("a"), p.sum("b"));
const c = new Conn(3);
console.log(c.sum("d"));
class Leaf extends Pool {}
console.log(new Leaf(9).show("leaf"));
console.log(p.show === undefined, new Leaf(1).sum("z"));
