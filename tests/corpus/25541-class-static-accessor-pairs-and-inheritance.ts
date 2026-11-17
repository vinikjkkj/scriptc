// Static accessors: a pair, a getter only and a setter only each describe their own halves; an inherited one is not an own property of the subclass.
class S {
  static n = 1;
  static get both() { return S.n; }
  static set both(v: number) { S.n = v; }
  static get ro() { return 5; }
  static set wo(v: number) { S.n = v * 10; }
}
class T extends S {}
const shape = (d: any): string => d === undefined ? "none" : `${typeof d.get},${typeof d.set},${d.enumerable},${d.configurable}`;
console.log(shape(Object.getOwnPropertyDescriptor(S, "both")), shape(Object.getOwnPropertyDescriptor(S, "ro")), shape(Object.getOwnPropertyDescriptor(S, "wo")));
console.log(shape(Object.getOwnPropertyDescriptor(T, "both")), shape(Object.getOwnPropertyDescriptor(T, "wo")));
const both: any = Object.getOwnPropertyDescriptor(S, "both");
const wo: any = Object.getOwnPropertyDescriptor(S, "wo");
console.log(both.get.name, both.set.name, wo.set.name);
wo.set.call(S, 3);
console.log(both.get.call(S), S.n);
