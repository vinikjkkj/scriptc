import { arrayParser } from "pgtypes";
const f = arrayParser;
console.log(typeof f, f === arrayParser);
function show(x: unknown): void {
  console.log(typeof x);
}
show(arrayParser);
const holder: { p: unknown } = { p: arrayParser };
console.log(typeof holder.p);
