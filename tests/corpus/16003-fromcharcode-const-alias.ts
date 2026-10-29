// A module-level const alias of String.fromCharCode whose every use is a call (the punycode.js
// shape): each call lowers as String.fromCharCode, with ToUint16 per code.
const stringFromCharCode = String.fromCharCode;
const baseMinusTMin = 35;
function digit(d: number): string {
  return stringFromCharCode(d < 26 ? d + 97 : d + 22);
}
function enc(cp: number): string {
  return stringFromCharCode(cp);
}
console.log(enc(65), enc(65601), enc(0x3b1), enc(-1).charCodeAt(0));
const out: string[] = [];
for (const c of [97, 98, 0xffff + 2]) out.push(stringFromCharCode(c));
console.log(out.join("|"), digit(3), digit(30), baseMinusTMin);
