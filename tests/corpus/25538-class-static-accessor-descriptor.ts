// A static accessor's own descriptor on the class value: { get, set, enumerable: false, configurable: true }, not a data property.
class S {
  static n = 1;
  static get z() { return S.n * 3; }
  static set z(v: number) { S.n = v; }
  static get only() { return 4; }
  static f() { return 2; }
}
const z: any = Object.getOwnPropertyDescriptor(S, "z");
console.log(typeof z.get, typeof z.set, z.enumerable, z.configurable, "value" in z);
console.log(z.get.name, z.set.name, z.get.call(S));
z.set.call(S, 5);
console.log(S.n, S.z);
const only: any = Object.getOwnPropertyDescriptor(S, "only");
console.log(only.get.name, only.set === undefined);
const f: any = Object.getOwnPropertyDescriptor(S, "f");
console.log(typeof f.value, f.writable, f.enumerable, f.configurable);
const n: any = Object.getOwnPropertyDescriptor(S, "n");
console.log(n.value, n.writable, n.enumerable, n.configurable);
