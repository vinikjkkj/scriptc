// Buffer numeric accessors through a dyn receiver (every family, LE/BE, float/double, variable width, BigInt) with literal names:
// in-range, boundary and out-of-range values, bad / fractional / non-number offsets and values, and receivers that are NOT
// Buffers (an object with a same-named method, a Uint8Array, a string). Each call prints its result or name:code:message.
function t(f) { try { const r = f(); return typeof r === "bigint" ? r + "n" : String(r); } catch (e) { return e.name + ":" + e.code + ":" + e.message; } }
const fake = {};
const fakeObj = { readUInt8(a, b, c) { return "fake-readUInt8:" + a + ":" + b + ":" + c; },readUint8(a, b, c) { return "fake-readUint8:" + a + ":" + b + ":" + c; },readInt8(a, b, c) { return "fake-readInt8:" + a + ":" + b + ":" + c; },readUInt16LE(a, b, c) { return "fake-readUInt16LE:" + a + ":" + b + ":" + c; },readUint16LE(a, b, c) { return "fake-readUint16LE:" + a + ":" + b + ":" + c; },readUInt16BE(a, b, c) { return "fake-readUInt16BE:" + a + ":" + b + ":" + c; },readUint16BE(a, b, c) { return "fake-readUint16BE:" + a + ":" + b + ":" + c; },readInt16LE(a, b, c) { return "fake-readInt16LE:" + a + ":" + b + ":" + c; },readInt16BE(a, b, c) { return "fake-readInt16BE:" + a + ":" + b + ":" + c; },readUInt32LE(a, b, c) { return "fake-readUInt32LE:" + a + ":" + b + ":" + c; },readUint32LE(a, b, c) { return "fake-readUint32LE:" + a + ":" + b + ":" + c; },readUInt32BE(a, b, c) { return "fake-readUInt32BE:" + a + ":" + b + ":" + c; },readUint32BE(a, b, c) { return "fake-readUint32BE:" + a + ":" + b + ":" + c; },readInt32LE(a, b, c) { return "fake-readInt32LE:" + a + ":" + b + ":" + c; },readInt32BE(a, b, c) { return "fake-readInt32BE:" + a + ":" + b + ":" + c; },readFloatLE(a, b, c) { return "fake-readFloatLE:" + a + ":" + b + ":" + c; },readFloatBE(a, b, c) { return "fake-readFloatBE:" + a + ":" + b + ":" + c; },readDoubleLE(a, b, c) { return "fake-readDoubleLE:" + a + ":" + b + ":" + c; },readDoubleBE(a, b, c) { return "fake-readDoubleBE:" + a + ":" + b + ":" + c; },writeUInt8(a, b, c) { return "fake-writeUInt8:" + a + ":" + b + ":" + c; },writeUint8(a, b, c) { return "fake-writeUint8:" + a + ":" + b + ":" + c; },writeInt8(a, b, c) { return "fake-writeInt8:" + a + ":" + b + ":" + c; },writeUInt16LE(a, b, c) { return "fake-writeUInt16LE:" + a + ":" + b + ":" + c; },writeUint16LE(a, b, c) { return "fake-writeUint16LE:" + a + ":" + b + ":" + c; },writeUInt16BE(a, b, c) { return "fake-writeUInt16BE:" + a + ":" + b + ":" + c; },writeUint16BE(a, b, c) { return "fake-writeUint16BE:" + a + ":" + b + ":" + c; },writeInt16LE(a, b, c) { return "fake-writeInt16LE:" + a + ":" + b + ":" + c; },writeInt16BE(a, b, c) { return "fake-writeInt16BE:" + a + ":" + b + ":" + c; },writeUInt32LE(a, b, c) { return "fake-writeUInt32LE:" + a + ":" + b + ":" + c; },writeUint32LE(a, b, c) { return "fake-writeUint32LE:" + a + ":" + b + ":" + c; },writeUInt32BE(a, b, c) { return "fake-writeUInt32BE:" + a + ":" + b + ":" + c; },writeUint32BE(a, b, c) { return "fake-writeUint32BE:" + a + ":" + b + ":" + c; },writeInt32LE(a, b, c) { return "fake-writeInt32LE:" + a + ":" + b + ":" + c; },writeInt32BE(a, b, c) { return "fake-writeInt32BE:" + a + ":" + b + ":" + c; },writeFloatLE(a, b, c) { return "fake-writeFloatLE:" + a + ":" + b + ":" + c; },writeFloatBE(a, b, c) { return "fake-writeFloatBE:" + a + ":" + b + ":" + c; },writeDoubleLE(a, b, c) { return "fake-writeDoubleLE:" + a + ":" + b + ":" + c; },writeDoubleBE(a, b, c) { return "fake-writeDoubleBE:" + a + ":" + b + ":" + c; },readUIntLE(a, b, c) { return "fake-readUIntLE:" + a + ":" + b + ":" + c; },readUintLE(a, b, c) { return "fake-readUintLE:" + a + ":" + b + ":" + c; },readUIntBE(a, b, c) { return "fake-readUIntBE:" + a + ":" + b + ":" + c; },readUintBE(a, b, c) { return "fake-readUintBE:" + a + ":" + b + ":" + c; },readIntLE(a, b, c) { return "fake-readIntLE:" + a + ":" + b + ":" + c; },readIntBE(a, b, c) { return "fake-readIntBE:" + a + ":" + b + ":" + c; },writeUIntLE(a, b, c) { return "fake-writeUIntLE:" + a + ":" + b + ":" + c; },writeUintLE(a, b, c) { return "fake-writeUintLE:" + a + ":" + b + ":" + c; },writeUIntBE(a, b, c) { return "fake-writeUIntBE:" + a + ":" + b + ":" + c; },writeUintBE(a, b, c) { return "fake-writeUintBE:" + a + ":" + b + ":" + c; },writeIntLE(a, b, c) { return "fake-writeIntLE:" + a + ":" + b + ":" + c; },writeIntBE(a, b, c) { return "fake-writeIntBE:" + a + ":" + b + ":" + c; }, };
function all(b, f, v, o, w) {
  const r = [];
  r.push(t(() => b.readUInt8(o)));
  r.push(t(() => f.readUInt8(v, o, w)));
  r.push(t(() => b.readUint8(o)));
  r.push(t(() => f.readUint8(v, o, w)));
  r.push(t(() => b.readInt8(o)));
  r.push(t(() => f.readInt8(v, o, w)));
  r.push(t(() => b.readUInt16LE(o)));
  r.push(t(() => f.readUInt16LE(v, o, w)));
  r.push(t(() => b.readUint16LE(o)));
  r.push(t(() => f.readUint16LE(v, o, w)));
  r.push(t(() => b.readUInt16BE(o)));
  r.push(t(() => f.readUInt16BE(v, o, w)));
  r.push(t(() => b.readUint16BE(o)));
  r.push(t(() => f.readUint16BE(v, o, w)));
  r.push(t(() => b.readInt16LE(o)));
  r.push(t(() => f.readInt16LE(v, o, w)));
  r.push(t(() => b.readInt16BE(o)));
  r.push(t(() => f.readInt16BE(v, o, w)));
  r.push(t(() => b.readUInt32LE(o)));
  r.push(t(() => f.readUInt32LE(v, o, w)));
  r.push(t(() => b.readUint32LE(o)));
  r.push(t(() => f.readUint32LE(v, o, w)));
  r.push(t(() => b.readUInt32BE(o)));
  r.push(t(() => f.readUInt32BE(v, o, w)));
  r.push(t(() => b.readUint32BE(o)));
  r.push(t(() => f.readUint32BE(v, o, w)));
  r.push(t(() => b.readInt32LE(o)));
  r.push(t(() => f.readInt32LE(v, o, w)));
  r.push(t(() => b.readInt32BE(o)));
  r.push(t(() => f.readInt32BE(v, o, w)));
  r.push(t(() => b.readFloatLE(o)));
  r.push(t(() => f.readFloatLE(v, o, w)));
  r.push(t(() => b.readFloatBE(o)));
  r.push(t(() => f.readFloatBE(v, o, w)));
  r.push(t(() => b.readDoubleLE(o)));
  r.push(t(() => f.readDoubleLE(v, o, w)));
  r.push(t(() => b.readDoubleBE(o)));
  r.push(t(() => f.readDoubleBE(v, o, w)));
  r.push(t(() => b.writeUInt8(v, o)));
  r.push(t(() => f.writeUInt8(v, o, w)));
  r.push(t(() => b.writeUint8(v, o)));
  r.push(t(() => f.writeUint8(v, o, w)));
  r.push(t(() => b.writeInt8(v, o)));
  r.push(t(() => f.writeInt8(v, o, w)));
  r.push(t(() => b.writeUInt16LE(v, o)));
  r.push(t(() => f.writeUInt16LE(v, o, w)));
  r.push(t(() => b.writeUint16LE(v, o)));
  r.push(t(() => f.writeUint16LE(v, o, w)));
  r.push(t(() => b.writeUInt16BE(v, o)));
  r.push(t(() => f.writeUInt16BE(v, o, w)));
  r.push(t(() => b.writeUint16BE(v, o)));
  r.push(t(() => f.writeUint16BE(v, o, w)));
  r.push(t(() => b.writeInt16LE(v, o)));
  r.push(t(() => f.writeInt16LE(v, o, w)));
  r.push(t(() => b.writeInt16BE(v, o)));
  r.push(t(() => f.writeInt16BE(v, o, w)));
  r.push(t(() => b.writeUInt32LE(v, o)));
  r.push(t(() => f.writeUInt32LE(v, o, w)));
  r.push(t(() => b.writeUint32LE(v, o)));
  r.push(t(() => f.writeUint32LE(v, o, w)));
  r.push(t(() => b.writeUInt32BE(v, o)));
  r.push(t(() => f.writeUInt32BE(v, o, w)));
  r.push(t(() => b.writeUint32BE(v, o)));
  r.push(t(() => f.writeUint32BE(v, o, w)));
  r.push(t(() => b.writeInt32LE(v, o)));
  r.push(t(() => f.writeInt32LE(v, o, w)));
  r.push(t(() => b.writeInt32BE(v, o)));
  r.push(t(() => f.writeInt32BE(v, o, w)));
  r.push(t(() => b.writeFloatLE(v, o)));
  r.push(t(() => f.writeFloatLE(v, o, w)));
  r.push(t(() => b.writeFloatBE(v, o)));
  r.push(t(() => f.writeFloatBE(v, o, w)));
  r.push(t(() => b.writeDoubleLE(v, o)));
  r.push(t(() => f.writeDoubleLE(v, o, w)));
  r.push(t(() => b.writeDoubleBE(v, o)));
  r.push(t(() => f.writeDoubleBE(v, o, w)));
  r.push(t(() => b.readUIntLE(o, w)));
  r.push(t(() => f.readUIntLE(v, o, w)));
  r.push(t(() => b.readUintLE(o, w)));
  r.push(t(() => f.readUintLE(v, o, w)));
  r.push(t(() => b.readUIntBE(o, w)));
  r.push(t(() => f.readUIntBE(v, o, w)));
  r.push(t(() => b.readUintBE(o, w)));
  r.push(t(() => f.readUintBE(v, o, w)));
  r.push(t(() => b.readIntLE(o, w)));
  r.push(t(() => f.readIntLE(v, o, w)));
  r.push(t(() => b.readIntBE(o, w)));
  r.push(t(() => f.readIntBE(v, o, w)));
  r.push(t(() => b.writeUIntLE(v, o, w)));
  r.push(t(() => f.writeUIntLE(v, o, w)));
  r.push(t(() => b.writeUintLE(v, o, w)));
  r.push(t(() => f.writeUintLE(v, o, w)));
  r.push(t(() => b.writeUIntBE(v, o, w)));
  r.push(t(() => f.writeUIntBE(v, o, w)));
  r.push(t(() => b.writeUintBE(v, o, w)));
  r.push(t(() => f.writeUintBE(v, o, w)));
  r.push(t(() => b.writeIntLE(v, o, w)));
  r.push(t(() => f.writeIntLE(v, o, w)));
  r.push(t(() => b.writeIntBE(v, o, w)));
  r.push(t(() => f.writeIntBE(v, o, w)));
  return r.join("|");
}
const bufs = [Buffer.alloc(16), Buffer.alloc(3), Buffer.alloc(0), Buffer.from([255, 254, 253, 252, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])];
const vals = [0, 1, 127, 128, 255, 256, -1, -128, -129, 32767, 32768, 65535, 65536, 2147483647, 2147483648, 4294967295, 4294967296, 1.5, -0, NaN, Infinity, 1e300, "7", "", null, undefined, true, { valueOf() { return 9; } }, 281474976710655, 140737488355327, 3.4e38];
const offs = [0, 1, 2, 3, 4, 8, 12, 15, 16, 17, -1, 1.5, NaN, Infinity, -0, 2147483648];
const ws = [1, 2, 3, 4, 5, 6, 0, 7, 1.5];
let k = 0;
for (let bi = 0; bi < bufs.length; bi++) {
  for (let i = 0; i < vals.length; i++) {
    const o = offs[(i * 3 + bi) % offs.length], w = ws[(i + bi) % ws.length];
    const b = Buffer.from(bufs[bi]);
    console.log(bi, i, all(b, fakeObj, vals[i], o, w), b.toString("hex"));
    k++;
  }
}
// non-Buffer receivers and plain calls with every offset
const u8 = new Uint8Array(8);
function viaU8(x) { return [t(() => x.readUInt8(0)), t(() => x.writeUInt8(1, 0)), t(() => x.readInt32LE(0)), t(() => x.writeDoubleBE(1, 0))].join("|"); }
console.log(viaU8(u8), viaU8("str"), viaU8(5), viaU8(null), viaU8(undefined), viaU8([1, 2]), viaU8({}));
function offsAll(b) { const r = []; for (let q = 0; q < offs.length; q++) { r.push(t(() => b.writeUInt8(5, offs[q]))); r.push(t(() => b.readUInt8(offs[q]))); r.push(t(() => b.readUInt16BE(offs[q]))); r.push(t(() => b.writeInt32LE(-5, offs[q]))); } return r.join("|"); }
console.log(offsAll(Buffer.alloc(9)));
console.log("done", k);
