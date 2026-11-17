// Object.getOwnPropertyDescriptor(K.prototype, "y") of a class accessor: { get, set, enumerable: false, configurable: true }, named "get y" / "set y".
class K {
  stored = 5;
  get y() { return this.stored * 2; }
  set y(v: number) { this.stored = v; }
  get ro() { return 9; }
  m() { return 1; }
}
const d = Object.getOwnPropertyDescriptor(K.prototype, "y")!;
console.log(typeof d.get, typeof d.set, d.enumerable, d.configurable);
console.log(d.get!.name, d.set!.name);
const k = new K();
console.log(d.get!.call(k));
d.set!.call(k, 21);
console.log(k.stored, k.y);
const r: any = Object.getOwnPropertyDescriptor(K.prototype, "ro");
console.log(r.get.name, r.set === undefined, r.get.call(k), r.enumerable, r.configurable);
const m: any = Object.getOwnPropertyDescriptor(K.prototype, "m");
console.log(typeof m.value, m.writable, m.enumerable, m.configurable, "get" in m);
