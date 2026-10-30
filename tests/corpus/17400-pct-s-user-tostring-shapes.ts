// util.format's %s over values whose toString or [Symbol.toPrimitive] is user
// code: Node converts them through String(arg). The record literal, the record
// typed by annotation, the record behind a union, the class instance (own and
// inherited), the class in a union with a number, and the record with a
// [Symbol.toPrimitive] member (hint "string") each print the user's answer.
import { format } from "node:util";

console.log(format("%s", { toString() { return "A"; } }));
const ob = { toString() { return "B"; } };
console.log(format("%s", ob));
const fieldFn = () => "FN";
console.log(format("%s", { toString: fieldFn }));
const rec: { toString(): string } = { toString() { return "RF"; } };
console.log(format("%s", rec));
const ul: { toString(): string } | null = Math.random() < 2 ? { toString() { return "UL"; } } : null;
console.log(format("%s", ul));
const rb: { x: number; toString(): string } | number = Math.random() < 2 ? { x: 1, toString() { return "UR"; } } : 3;
console.log(format("%s", rb));
class C { toString() { return "C"; } }
console.log(format("%s", new C()));
class P { toString() { return "P"; } }
class Q extends P {}
console.log(format("%s", new Q()));
class Base { toString() { return "BASE"; } }
const inst = new Base();
const holder: { x: Base } = { x: inst };
console.log(format("%s", holder.x));
const uU: C | number = Math.random() < 2 ? new C() : 3;
console.log(format("%s", uU));
console.log(format("%s", { [Symbol.toPrimitive](h: string) { return "TP:" + h; } }));
console.log(format("%s|%s", new C(), 7));
