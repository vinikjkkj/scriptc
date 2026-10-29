// bson node byte codecs over the Buffer surface: base64 and hex with odd and
// invalid input, latin1 round trips, utf8 with invalid sequences (non-fatal),
// utf8 byte counts, zero-fill of allocate, copy/equals/compare/swap32 results.
type NodeJsEncoding = 'base64' | 'hex' | 'utf8' | 'binary';
type NodeJsBuffer = ArrayBufferView &
  Uint8Array & {
    copy(target: Uint8Array, targetStart: number, sourceStart: number, sourceEnd: number): number;
    toString: (this: Uint8Array, encoding: NodeJsEncoding, start?: number, end?: number) => string;
    equals: (this: Uint8Array, other: Uint8Array) => boolean;
    swap32: (this: NodeJsBuffer) => NodeJsBuffer;
    compare: (this: Uint8Array, other: Uint8Array) => -1 | 0 | 1;
  };

function toHex(b: Uint8Array): string {
  const nb = Buffer.from(b) as NodeJsBuffer;
  return nb.toString('hex');
}

const z = Buffer.alloc(6) as NodeJsBuffer;
console.log("zero", z.length, z[0], z[5], toHex(z));
const e = Buffer.from([]) as NodeJsBuffer;
console.log("empty", e.length, e.toString('base64'), e.toString('hex'), JSON.stringify(e.toString('utf8')));
console.log("b64", Buffer.from("aGk", 'base64').toString('hex'), Buffer.from("aGk=", 'base64').toString('utf8'));
console.log("b64 junk", Buffer.from("!!aGVs bG8=", 'base64').toString('utf8'));
console.log("hex odd", Buffer.from("abc", 'hex').toString('hex'), Buffer.from("zz00", 'hex').length);
console.log("latin1", Buffer.from("éÿ", 'binary').toString('binary'), Buffer.from("é", 'binary').length);
const bad = Buffer.from([0x41, 0xe2, 0x82, 0x41, 0xf0, 0x9f, 0x98]) as NodeJsBuffer;
console.log("bad utf8", JSON.stringify(bad.toString('utf8', 0, bad.length)), bad.length);
console.log("utf8 count", Buffer.byteLength("é✓😀", 'utf8'), Buffer.byteLength("", 'utf8'));
const src = Buffer.from([1, 2, 3, 4]) as NodeJsBuffer;
const dst = Buffer.alloc(4) as NodeJsBuffer;
console.log("copy", src.copy(dst, 1, 0, 3), dst.toString('hex'));
console.log("equals", src.equals(Buffer.from([1, 2, 3, 4])), src.equals(dst));
console.log("compare", src.compare(dst), dst.compare(src), src.compare(src));
const s32 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) as NodeJsBuffer;
console.log("swap32", s32.swap32().toString('hex'), s32.toString('hex'));
