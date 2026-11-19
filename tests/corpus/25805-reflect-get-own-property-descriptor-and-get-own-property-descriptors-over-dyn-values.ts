// Reflect.getOwnPropertyDescriptor and Object.getOwnPropertyDescriptors over checked-dynamic and typed values (own-name order, arrays, strings, accessors, TypeErrors).
function mk(): any { return JSON.parse('{"a":1,"b":{"c":2},"3":"x"}'); }
const o = mk();
console.log(Reflect.getOwnPropertyDescriptor(o, "a"));
console.log(Reflect.getOwnPropertyDescriptor(o, "zz"));
console.log(Reflect.getOwnPropertyDescriptor(o, "3"));
console.log(Object.getOwnPropertyDescriptors(o));
console.log(Object.getOwnPropertyDescriptors(JSON.parse("[7]")));
console.log(Object.getOwnPropertyDescriptors("hi"));
console.log(Object.getOwnPropertyDescriptors(JSON.parse("{}")));
const typed = { y: 2, z: [1] };
console.log(Object.getOwnPropertyDescriptors(typed));
console.log(Reflect.getOwnPropertyDescriptor(typed, "y"));
const prim: any = 5;
for (const f of [() => Reflect.getOwnPropertyDescriptor(prim, "x"), () => Object.getOwnPropertyDescriptor(prim, "x"), () => Object.getOwnPropertyDescriptors(prim), () => Object.getOwnPropertyDescriptors(null as any)]) {
  try { console.log(f()); } catch (e) { console.log((e as Error).message); }
}
const acc: any = JSON.parse("{}");
Object.defineProperty(acc, "g", { get() { return 1; }, enumerable: true, configurable: true });
const d = Reflect.getOwnPropertyDescriptor(acc, "g")!;
console.log(typeof d.get, d.set, d.enumerable, d.configurable);
const copy: any = Object.create(Object.getPrototypeOf(acc), Object.getOwnPropertyDescriptors(acc));
console.log(copy.g);
