// An expando written through an untyped view reaches a generic instantiation
// (Box<number>) and a derived class (Sub extends Base) the same as any class:
// the write is stored, read back, and listed after the declared members.
class Box<T> {
  v: T;
  constructor(v: T) { this.v = v; }
}
class Base {
  v: number;
  constructor(v: number) { this.v = v; }
  bm(): string { return "bm" + this.v; }
}
class Sub extends Base {
  extra: number = 2;
  constructor() { super(1); }
}
const b: any = new Box<number>(5);
b.pool = "gp";
console.log("generic", b.pool, b.v, "pool" in b);
const s: any = new Sub();
s.pool = "sp";
console.log("sub", s.pool, s.v, s.extra, "pool" in s, s.bm());
const plain: any = new Base(3);
plain.tag = "t";
console.log(JSON.stringify(plain), plain.tag);
