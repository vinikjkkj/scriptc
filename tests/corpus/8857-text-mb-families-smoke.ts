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
const g = new TextDecoder("gbk");
console.log("gbk", show(() => g.decode(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0x41, 0x80]))));
const g18 = new TextDecoder("gb18030");
console.log("gb18030", show(() => g18.decode(new Uint8Array([0x81, 0x30, 0x81, 0x30, 0x80, 0xa3, 0xa0]))));
const b5 = new TextDecoder("big5");
console.log("big5", show(() => b5.decode(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5, 0x41]))));
const ej = new TextDecoder("euc-jp");
console.log("euc-jp", show(() => ej.decode(new Uint8Array([0xc6, 0xfc, 0x8e, 0xb1, 0x8f, 0xb0, 0xa1, 0x41]))));
const sj = new TextDecoder("shift_jis");
console.log("sjis", show(() => sj.decode(new Uint8Array([0x93, 0xfa, 0xb1, 0x82, 0xa0, 0x41]))));
const kr = new TextDecoder("euc-kr");
console.log("euc-kr", show(() => kr.decode(new Uint8Array([0xb0, 0xa1, 0xc7, 0xd1, 0x41]))));
