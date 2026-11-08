// The result of Object.getOwnPropertyDescriptor bound to a local: the descriptor object is a PropertyDescriptor, accessor halves included.
const a = {};
Object.defineProperty(a, "acc", { get() { return 41; }, enumerable: true, configurable: true });
Object.defineProperty(a, "both", { get() { return 1; }, set(v) {}, configurable: true });
a.data = 5;
const d1 = Object.getOwnPropertyDescriptor(a, "acc");
console.log(typeof d1.get, typeof d1.set, d1.enumerable, d1.configurable, d1.value);
const d2 = Object.getOwnPropertyDescriptor(a, "both");
console.log(typeof d2.get, typeof d2.set, d2.enumerable);
const d3 = Object.getOwnPropertyDescriptor(a, "data");
console.log(d3.value, d3.writable, typeof d3.get);
const d4 = Object.getOwnPropertyDescriptor(a, "nope");
console.log(d4 === undefined);
function descOf(o, k) { return Object.getOwnPropertyDescriptor(o, k); }
const d5 = descOf(a, "acc");
console.log(typeof d5.get, d5.enumerable);
