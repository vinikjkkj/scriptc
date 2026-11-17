// The accessor functions of a class prototype run against an instance of the class or of a subclass, through call and apply.
class Base {
  stored = 5;
  get doubled() { return this.stored * 2; }
  set doubled(v: number) { this.stored = v / 2; }
}
class Derived extends Base { extra = 1; }
const d = Object.getOwnPropertyDescriptor(Base.prototype, "doubled")!;
const b = new Base();
const sub = new Derived();
console.log(d.get!.call(b), d.get!.call(sub), d.get!.apply(sub, []));
d.set!.call(sub, 40);
d.set!.apply(b, [8]);
console.log(sub.stored, b.stored, sub.doubled, b.doubled);
console.log(Object.getOwnPropertyDescriptor(Derived.prototype, "doubled") === undefined);
