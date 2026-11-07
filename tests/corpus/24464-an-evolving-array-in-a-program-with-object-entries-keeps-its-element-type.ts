// `const buffer = []` is an EVOLVING array: the checker types the declaration by what is pushed later. In a program that also calls
// Object.entries / Object.values on an `object` (where tsc's `never` element is a dyn value), the array must keep the element type its
// pushes give it: it became an array of dyn, and Uint8Array.from over it had no lowering (mongodb web_byte_utils.ts:258).
function fromHex(hex: string): Uint8Array {
  const buffer = [];
  for (let i = 0; i < hex.length; i += 2) {
    const hexDigit = Number.parseInt(hex.slice(i, i + 2), 16);
    buffer.push(hexDigit);
  }
  return Uint8Array.from(buffer);
}
function squares(n: number): number[] {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i * i);
  return out;
}
const d = JSON.parse('{"a":1,"b":"two"}') as Record<string, unknown>;
const o: object = d;
console.log(Object.entries(o).length, Object.values(o).length);
console.log(fromHex("0aff10").join(","), squares(4).join(","), squares(0).length);
