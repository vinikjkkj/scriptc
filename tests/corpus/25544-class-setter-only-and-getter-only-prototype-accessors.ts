// A setter-only accessor has get undefined, a getter-only one has set undefined, and a plain method is a data property; all non-enumerable.
class P {
  hidden = 1;
  set wo(v: number) { this.hidden = v; }
  get ro() { return this.hidden + 100; }
  m() { return 7; }
}
const shape = (d: any): string => d === undefined ? "none" : `${typeof d.get},${typeof d.set},${typeof d.value},${d.writable},${d.enumerable},${d.configurable}`;
console.log(shape(Object.getOwnPropertyDescriptor(P.prototype, "wo")), shape(Object.getOwnPropertyDescriptor(P.prototype, "ro")), shape(Object.getOwnPropertyDescriptor(P.prototype, "m")));
const wo: any = Object.getOwnPropertyDescriptor(P.prototype, "wo");
const ro: any = Object.getOwnPropertyDescriptor(P.prototype, "ro");
const p = new P();
wo.set.call(p, 9);
console.log(wo.set.name, ro.get.name, ro.get.call(p), p.hidden);
console.log(Object.getOwnPropertyNames(P.prototype).join(","));
