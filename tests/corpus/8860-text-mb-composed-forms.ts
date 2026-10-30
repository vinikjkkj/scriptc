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
console.log("a", show(() => new TextDecoder("big5").decode(new Uint8Array([0xa4]), { stream: true })));
console.log("b", show(() => new TextDecoder("euc-kr", { fatal: true }).decode(new Uint8Array([0xb0, 0xa1]))));
console.log("c", show(() => new TextDecoder("gb18030").decode(new Uint8Array([0x81, 0x30, 0x81, 0x30]), { stream: true })));
console.log("d", show(() => new TextDecoder("shift_jis").decode(new Uint8Array([0x82]), { stream: true })));
console.log("e", show(() => new TextDecoder("euc-jp").decode(new Uint8Array([0x8f, 0xa1]), { stream: false })));
console.log("f", show(() => new TextDecoder("euc-jp").decode(new Uint8Array([0x8f, 0xa1, 0xa1]))));
console.log("g", show(() => new TextDecoder("gbk").decode(new Uint16Array([0x4f60]))));
console.log("h", show(() => new TextDecoder("euc-kr", { fatal: true }).decode(new Uint8Array([0xa1]))));
