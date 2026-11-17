// The getter and setter of an object literal property, read off its descriptor, are named "get x" / "set x", typed or not.
const o = { get x() { return 1; }, set x(v: number) {}, get ro() { return 7; } };
const d = Object.getOwnPropertyDescriptor(o, "x")!;
console.log(d.get!.name, d.set!.name, typeof d.get, typeof d.set, d.enumerable, d.configurable);
const r: any = Object.getOwnPropertyDescriptor(o, "ro");
console.log(r.get.name, r.set === undefined, r.get.call(o));
const e: any = Object.getOwnPropertyDescriptor(o, "x");
console.log(e.get.name, e.set.name, e.get.call(o));
