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
const x: any = new TextDecoder("utf-8");
console.log("a", show(() => x.decode(new Uint8Array([0xe2, 0x82]), { stream: true })));
console.log("b", show(() => x.decode(new Uint8Array([0xac, 0x41]), { stream: true })));
console.log("c", show(() => x.decode()));
const y: any = new TextDecoder("utf-16le", { fatal: true });
console.log("d", show(() => y.decode(new Uint8Array([0x41]), { stream: true })));
console.log("e", show(() => y.decode(new Uint8Array([0x00]))));
console.log("f", show(() => y.decode(new Uint8Array([0x00]), { stream: true })));
console.log("g", show(() => y.decode(new Uint8Array([0x00, 0xd8]), { stream: true })));
console.log("h", show(() => y.decode()));
const z: any = new TextDecoder("windows-1252");
console.log("i", show(() => z.decode(new Uint8Array([0x80, 0x81]), null)));
const w = new TextDecoder("utf-8");
const alias: any = w;
console.log("j", show(() => alias.decode(new Uint8Array([0xe2]), { stream: true })), show(() => w.decode(new Uint8Array([0x82, 0xac]))));
