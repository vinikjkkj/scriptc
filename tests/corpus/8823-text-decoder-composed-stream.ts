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
console.log("a", show(() => new TextDecoder().decode(new Uint8Array([0xe2, 0x82, 0xac, 0xe2]), { stream: true })));
console.log("b", show(() => new TextDecoder().decode(new Uint8Array([0xe2]), { stream: true })));
console.log("c", show(() => new TextDecoder("utf-16le").decode(new Uint8Array([0x41, 0x00, 0x42]), { stream: true })));
console.log("d", show(() => new TextDecoder("utf-16be", { fatal: true }).decode(new Uint8Array([0x00, 0x41, 0x00]), { stream: true })));
console.log("e", show(() => new TextDecoder("windows-1252").decode(new Uint8Array([0x80, 0xe9]), { stream: true })));
console.log("f", show(() => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xe2, 0x41]), { stream: true })));
console.log("g", show(() => new TextDecoder().decode(new Uint8Array([0xe2]), { stream: false })));
console.log("h", show(() => new TextDecoder().decode(new Uint16Array([0x41, 0x42]), { stream: true })));
console.log("i", show(() => new TextDecoder().decode(undefined, { stream: true })));
console.log("j", show(() => new TextDecoder().decode()));
const v: any = new Uint8Array([0xf0, 0x9f]);
console.log("k", show(() => new TextDecoder().decode(v, { stream: true })));
console.log("l", show(() => new TextDecoder().decode(v)));
