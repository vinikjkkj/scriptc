// C.prototype and Object.getPrototypeOf(instance) are ONE object, and a derived prototype links to its base's.
class Base { greet(): string { return "hi"; } }
class Mid extends Base { more(): number { return 3; } }
class Leaf extends Mid {}
class Other extends Base {}
const b = new Base(), m = new Mid(), l = new Leaf(), o = new Other();
console.log(Object.getPrototypeOf(b) === Base.prototype, Object.getPrototypeOf(m) === Mid.prototype, Object.getPrototypeOf(l) === Leaf.prototype);
console.log(Object.getPrototypeOf(l) === Mid.prototype, Object.getPrototypeOf(m) === Base.prototype, Object.getPrototypeOf(o) === Base.prototype);
console.log(Object.getPrototypeOf(Leaf.prototype) === Mid.prototype, Object.getPrototypeOf(Mid.prototype) === Base.prototype, Object.getPrototypeOf(Other.prototype) === Base.prototype);
console.log(Base.prototype === Base.prototype, Mid.prototype === Base.prototype, Object.getPrototypeOf(b) === Object.getPrototypeOf(new Base()));
class Maker {
  same: boolean;
  constructor() { this.same = Object.getPrototypeOf(this) === new.target.prototype; }
}
class Made extends Maker {}
console.log(new Maker().same, new Made().same);
