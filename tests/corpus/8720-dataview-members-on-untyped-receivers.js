// Every DataView member reached through a receiver the compiler cannot
// type (an untyped parameter). The DataView rides the typed-array box with
// a flavor of its own; the dynamic dispatch used to know only the
// typed-array names, so `x.getUint8(0)` built clean and threw "x.getUint8
// is not a function" where Node answers, `x.byteLength` read undefined, and
// `x.length` / `x[0]` answered numbers for an object that has neither.
// No bigint literal appears anywhere in this file: getBigInt64 and
// friends are the only thing that brings the bigint unit into the link.
'use strict';

function mk() {
  const u = new Uint8Array(24);
  for (let i = 0; i < u.length; i++) u[i] = (i * 37 + 11) & 255;
  return new DataView(u.buffer, 4, 16);
}
function T(name, f) {
  try {
    const r = f();
    console.log(name, typeof r, String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.message);
  }
}

function run(x) {
  T("byteLength", () => x.byteLength);
  T("byteOffset", () => x.byteOffset);
  T("length", () => x.length);
  T("index", () => x[0]);
  T("typeof", () => typeof x);
  T("typeof getUint8", () => typeof x.getUint8);
  T("typeof setFloat64", () => typeof x.setFloat64);
  T("typeof at", () => typeof x.at);
  T("toString", () => Object.prototype.toString.call(x));
  T("String", () => String(x));
  T("toLocaleString", () => x.toLocaleString());
  // the integer families, both byte orders
  T("getUint8", () => x.getUint8(1));
  T("getInt8", () => x.getInt8(1));
  T("setInt8", () => x.setInt8(0, -2));
  T("getUint8 after", () => x.getUint8(0));
  T("getUint16 BE", () => x.getUint16(2));
  T("getUint16 LE", () => x.getUint16(2, true));
  T("getInt16 LE", () => x.getInt16(2, true));
  T("setUint16", () => x.setUint16(2, 0xbeef));
  T("getUint16 after", () => x.getUint16(2));
  T("setInt16 LE", () => x.setInt16(4, -300, true));
  T("getInt16 BE", () => x.getInt16(4));
  T("getUint32 BE", () => x.getUint32(4));
  T("getUint32 LE", () => x.getUint32(4, true));
  T("setUint32", () => x.setUint32(8, 4294967295));
  T("getInt32", () => x.getInt32(8));
  T("setInt32 LE", () => x.setInt32(8, -123456789, true));
  T("getInt32 LE", () => x.getInt32(8, true));
  // the float families
  T("setFloat32", () => x.setFloat32(0, 1.5));
  T("getFloat32", () => x.getFloat32(0));
  T("setFloat32 round", () => x.setFloat32(0, 16777217));
  T("getFloat32 round", () => x.getFloat32(0));
  T("setFloat64 LE", () => x.setFloat64(8, Math.PI, true));
  T("getFloat64 LE", () => x.getFloat64(8, true));
  T("getFloat64 BE of the same bytes", () => x.getFloat64(8));
  T("setFloat64 NaN", () => x.setFloat64(8, NaN));
  T("getFloat64 NaN", () => x.getFloat64(8));
  T("setFloat16", () => x.setFloat16(0, 1.5));
  T("getFloat16", () => x.getFloat16(0));
  T("setFloat16 tie", () => x.setFloat16(0, 2049));
  T("getFloat16 tie", () => x.getFloat16(0));
  T("setFloat16 big", () => x.setFloat16(0, 65520));
  T("getFloat16 big", () => x.getFloat16(0));
  T("setFloat16 tiny", () => x.setFloat16(0, 5.960464477539063e-8));
  T("getFloat16 tiny", () => x.getFloat16(0));
  T("setFloat16 neg zero", () => x.setFloat16(0, -0));
  T("getFloat16 neg zero", () => 1 / x.getFloat16(0));
  // the bigint pair: stored from a string and a boolean, read back as the
  // bigint they are
  T("setBigInt64 str", () => x.setBigInt64(0, "-5"));
  T("getBigInt64", () => x.getBigInt64(0));
  T("getBigUint64", () => x.getBigUint64(0));
  T("setBigUint64 hex", () => x.setBigUint64(0, "0xffffffffffffffff", true));
  T("getBigUint64 LE", () => x.getBigUint64(0, true));
  T("getBigInt64 LE", () => x.getBigInt64(0, true));
  T("setBigInt64 true", () => x.setBigInt64(8, true));
  T("getBigInt64 true", () => x.getBigInt64(8));
  T("setBigInt64 wraps", () => x.setBigUint64(8, "18446744073709551617"));
  T("getBigUint64 wraps", () => x.getBigUint64(8));
  T("typeof bigint", () => typeof x.getBigInt64(0));
  T("setBigInt64 number", () => x.setBigInt64(0, 5));
  T("setBigInt64 undefined", () => x.setBigInt64(0));
  T("setBigInt64 junk", () => x.setBigInt64(0, "12abc"));
  // the offset is ToIndex'd and the bounds are the view's, not the buffer's
  T("string offset", () => x.getUint8("2"));
  T("fraction offset", () => x.getUint8(2.9));
  T("missing offset", () => x.getUint8());
  T("undefined offset", () => x.getUint8(undefined));
  T("last byte", () => x.getUint8(15));
  T("past the view", () => x.getUint8(16));
  T("wide straddles the end", () => x.getUint32(13));
  T("setter past the view", () => x.setFloat64(9, 1));
  T("negative offset", () => x.getInt8(-1));
  T("infinite offset", () => x.getInt8(Infinity));
  T("negative wins over a bad value", () => x.setBigInt64(-1, 5));
  T("the second argument is the byte order", () => x.getUint16(0, 1));
  T("a falsy byte order", () => x.getUint16(0, 0));
  T("a missing method", () => x.nope());
  T("typed-array names are not here", () => x.subarray(0));
  T("fill is not here", () => x.fill(0));
}
run(mk());

// a view over the SAME storage sees the writes: the box shares, it does not copy
const u = new Uint8Array(8);
const v = new DataView(u.buffer);
function poke(d) { d.setUint32(0, 0x01020304); d.setUint16(6, 0xaabb, true); }
poke(v);
{ const o = []; for (let i = 0; i < u.length; i++) o.push(u[i]); console.log(o.join(",")); }
function peek(d) { return d.getUint32(0) + ":" + d.getUint16(6, true); }
console.log(peek(v));

// the receiver chosen at run time
function pick(which, d) { return which ? d.getUint8(0) : d.getUint8(1); }
console.log(pick(true, v), pick(false, v));

// a computed method name reaches the same table
function byName(d, n, a, b) { return d[n](a, b); }
console.log(byName(v, "getUint16", 0), byName(v, "getUint16", 0, true));
console.log(String(byName(v, "getBigUint64", 0)));
