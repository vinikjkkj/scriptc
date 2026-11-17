// A PropertyDescriptor-typed parameter whose get/set is called with an instance of the accessor's class (or a subclass) runs the accessor against it.
class K {
  stored = 5;
  get y() { return this.stored * 2; }
  set y(v: number) { this.stored = v; }
}
class Sub extends K {}
function read(d: PropertyDescriptor, o: K): any { return d.get!.call(o); }
function write(d: PropertyDescriptor, o: K, v: number): void { d.set!.call(o, v); }
const d = Object.getOwnPropertyDescriptor(K.prototype, "y")!;
const k = new K();
const s = new Sub();
console.log(read(d, k), read(d, s));
write(d, k, 21);
write(d, s, 4);
console.log(k.stored, s.stored, read(d, k), read(d, s));
