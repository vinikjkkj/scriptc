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
const u16 = new Uint16Array([0x41, 0x42, 0xe9]);
console.log("u16", show(() => new TextDecoder().decode(u16)));
console.log("u16fatal", show(() => new TextDecoder("utf-16le", { fatal: true }).decode(u16)));
console.log("u16be", show(() => new TextDecoder("utf-16be").decode(new Uint16Array([0x4100, 0xfeff]))));
console.log("u16sub", show(() => new TextDecoder("utf-16le").decode(u16.subarray(1))));
console.log("i16", show(() => new TextDecoder("windows-1252").decode(new Int16Array([-1, 0x41]))));
console.log("u8c", show(() => new TextDecoder("windows-1252").decode(new Uint8ClampedArray([0x80, 0x41]))));
console.log("f32", show(() => new TextDecoder().decode(new Float32Array([1]))));
console.log("f64", show(() => new TextDecoder().decode(new Float64Array([1.5]))));
console.log("i32", show(() => new TextDecoder().decode(new Int32Array([0x21, 0x22]))));
console.log("u32", show(() => new TextDecoder("utf-16be").decode(new Uint32Array([0x1f600]))));
console.log("empty", show(() => new TextDecoder().decode(new Uint16Array(0))));
console.log("u8sub", show(() => new TextDecoder().decode(new Uint8Array([0x68, 0x69, 0x21]).subarray(1))));
console.log("ign", show(() => new TextDecoder("utf-16le", { ignoreBOM: true }).decode(new Uint16Array([0xfeff, 0x41]))));
console.log("bom", show(() => new TextDecoder("utf-16le").decode(new Uint16Array([0xfeff, 0x41]))));
