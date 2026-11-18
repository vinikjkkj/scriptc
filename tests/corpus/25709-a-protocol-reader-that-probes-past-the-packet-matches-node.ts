// A packet reader written for JS: it indexes without checking the length and relies on undefined, NaN-in-arithmetic and ignored writes for a short packet.
function readU16(p: Uint8Array, at: number): number { return (p[at] << 8) | p[at + 1]; }
function readU32(p: Uint8Array, at: number): number { return ((p[at] << 24) | (p[at + 1] << 16) | (p[at + 2] << 8) | p[at + 3]) >>> 0; }
function readVarint(p: Uint8Array, at: number): { value: number; next: number } {
  let value = 0, shift = 0, k = at;
  for (;;) {
    const byte = p[k];
    if (byte === undefined) return { value: -1, next: k };
    value |= (byte & 0x7f) << shift;
    k++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: k };
}
function writeU16(p: Uint8Array, at: number, v: number): void { p[at] = v >> 8; p[at + 1] = v & 255; }
const pkt = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0x81, 0x01, 0x80]);
console.log(readU16(pkt, 0), readU16(pkt, 6), readU16(pkt, 7), readU16(pkt, 8), readU16(pkt, 100));
console.log(readU32(pkt, 0), readU32(pkt, 4), readU32(pkt, 6), readU32(pkt, 9));
console.log(readVarint(pkt, 5), readVarint(pkt, 7), readVarint(pkt, 8));
const out = new Uint8Array(3);
writeU16(out, 0, 0xabcd);
writeU16(out, 2, 0xef01);
writeU16(out, 9, 0xffff);
console.log(out.join(","), out.length);
