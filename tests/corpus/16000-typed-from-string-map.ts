// Uint8Array.from(string, mapFn): the code-point walk, the mapper's (value, index), and the
// constructor's ToUint8 wrap on the mapped numbers (256 -> 0, -1 -> 255, 1.7 -> 1, NaN -> 0).
function fromLatin1(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function fromLatin1Mask(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
}
const a = fromLatin1("AZÿ\u0080");
const b = fromLatin1Mask("éāx");
console.log(Array.from(a).join(","), Array.from(b).join(","), a.length, b.length);

const vals: number[] = [256, -1, 1.7, NaN, 300, -257];
const u = Uint8Array.from("abcdef", (c: string, i: number) => vals[i]!);
console.log(Array.from(u).join(","));
const seen = Uint8Array.from("x\u{1F600}y", (c: string, i: number) => c.length * 10 + i);
console.log(Array.from(seen).join(","), seen.length);
