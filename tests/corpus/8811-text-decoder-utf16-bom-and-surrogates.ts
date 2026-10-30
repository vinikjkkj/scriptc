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
console.log(0, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([65, 0, 66]))));
console.log(1, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([65, 0, 66]))));
console.log(2, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([0, 216]))));
console.log(3, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([0, 216]))));
console.log(4, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([255, 254, 65, 0]))));
console.log(5, show(() => new TextDecoder("utf-16le", { ignoreBOM: true }).decode(new Uint8Array([255, 254, 65, 0]))));
console.log(6, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([254, 255, 65, 0]))));
console.log(7, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([255]))));
console.log(8, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([255]))));
console.log(9, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([255, 254]))));
console.log(10, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([]))));
console.log(11, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([61, 216, 0, 222]))));
console.log(12, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([61, 216, 65, 0]))));
console.log(13, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([0, 220]))));
console.log(14, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([0, 220]))));
console.log(15, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([0, 65]))));
console.log(16, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([254, 255, 0, 65]))));
console.log(17, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([255, 254, 0, 65]))));
console.log(18, show(() => new TextDecoder("utf-16be", { ignoreBOM: true }).decode(new Uint8Array([255, 254, 0, 65]))));
console.log(19, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([0]))));
console.log(20, show(() => new TextDecoder("utf-16be", { fatal: true }).decode(new Uint8Array([0]))));
console.log(21, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([216, 61, 222, 0]))));
console.log(22, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([216, 61, 0]))));
console.log(23, show(() => new TextDecoder("utf-16be", { fatal: true }).decode(new Uint8Array([216, 61, 0]))));
console.log(24, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([254, 255]))));
console.log(25, show(() => new TextDecoder("utf-16be", { fatal: true }).decode(new Uint8Array([254, 255]))));
console.log(26, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([254, 255]))));
console.log(27, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([255, 254, 255, 254]))));
console.log(28, show(() => new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array([255, 254, 0, 216, 65, 0]))));
console.log(29, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([255, 254, 65]))));
console.log(30, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([216, 0, 220, 0, 216]))));
console.log(31, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([0, 216, 0, 216, 0, 220]))));
console.log(32, show(() => new TextDecoder("utf-16le").decode(new Uint8Array([61, 216, 0, 222, 61, 216]))));
console.log(33, show(() => new TextDecoder("utf-16be").decode(new Uint8Array([216, 61, 0, 65, 220, 0]))));
