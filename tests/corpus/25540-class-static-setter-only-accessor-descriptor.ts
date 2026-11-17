// A static setter with no getter is an accessor property whose get is undefined: not a data property.
class S {
  static store = 0;
  static set w(v: number) { S.store = v; }
}
const w: any = Object.getOwnPropertyDescriptor(S, "w");
console.log(typeof w, w.get === undefined, typeof w.set, w.enumerable, w.configurable, "value" in w, "writable" in w);
console.log(w.set.name);
w.set.call(S, 8);
console.log(S.store, (S as any).w);
