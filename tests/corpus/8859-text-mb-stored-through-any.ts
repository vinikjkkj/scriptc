function cps(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; i++) r += s.charCodeAt(i).toString(16) + " ";
  return r;
}
function show(f: () => string): string {
  try {
    return "OK:" + cps(f());
  } catch {
    return "ERR";
  }
}
const x: any = new TextDecoder("big5");
console.log("a", show(() => x.decode(new Uint8Array([0xa4]), { stream: true })));
console.log("b", show(() => x.decode(new Uint8Array([0xa4, 0x41]), { stream: true })));
console.log("c", show(() => x.decode()));
const y: any = new TextDecoder("euc-kr", { fatal: true });
console.log("d", show(() => y.decode(new Uint8Array([0xb0]), { stream: true })));
console.log("e", show(() => y.decode(new Uint8Array([0xa1]))));
console.log("f", show(() => y.decode(new Uint8Array([0xb0, 0xa1]))));
const z: any = new TextDecoder("shift_jis");
console.log("g", show(() => z.decode(new Uint8Array([0x81, 0x40, 0x82]), null as any)));
console.log("h", show(() => z.decode(new Uint8Array([0x82, 0xa0]))));
