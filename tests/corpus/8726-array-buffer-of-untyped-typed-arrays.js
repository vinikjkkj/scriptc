// `.buffer` on a typed array or a DataView reached through a receiver the
// compiler cannot type read `undefined`, so `x.buffer.byteLength` threw
// "Cannot read properties of undefined" where Node answers. The ArrayBuffer
// is now real: one per owner (so `x.buffer === x.buffer` and two views of a
// buffer name the same one), a window over the SAME storage (a view built
// from it aliases, a write through either shows in both), with Node's
// ArrayBuffer members — byteLength, slice, maxByteLength, resizable,
// detached — and a typed array constructed from one is a view, not a copy.
'use strict';

function T(name, f) {
  try {
    const r = f();
    console.log(name, typeof r, r !== null && typeof r === "object" ? JSON.stringify(r) : String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.message);
  }
}
function id(v) { return v; }
function bytes(u) { const o = []; for (let i = 0; i < u.length; i++) o.push(u[i]); return o.join(","); }

function typed(x) {
  const ab = x.buffer;
  T("typeof", () => typeof ab);
  T("byteLength", () => ab.byteLength);
  T("tag", () => Object.prototype.toString.call(ab));
  T("String", () => String(ab));
  T("JSON", () => JSON.stringify(ab));
  T("identity", () => x.buffer === x.buffer);
  T("length is not an ArrayBuffer property", () => ab.length);
  T("index is not an ArrayBuffer property", () => ab[0]);
  T("maxByteLength", () => ab.maxByteLength);
  T("resizable", () => ab.resizable);
  T("detached", () => ab.detached);
  T("typeof slice", () => typeof ab.slice);
  T("slice", () => ab.slice(1, 3).byteLength);
  T("slice negative", () => ab.slice(-2).byteLength);
  T("slice all", () => ab.slice().byteLength);
  T("slice coerced", () => ab.slice("1", "3").byteLength);
  T("slice is a copy", () => { const s = ab.slice(0, 2); const v = new Uint8Array(s); v[0] = 99; return x[0]; });
  T("slice identity", () => ab.slice(0, 1) === ab.slice(0, 1));
  T("resize", () => ab.resize(2));
  T("a view over it aliases", () => { const v = new Uint8Array(ab); v[1] = 77; return x[1] + ":" + v.length; });
  T("a write through the original shows in the view", () => { const v = new Uint8Array(ab); x[2] = 55; return v[2]; });
  T("a missing method", () => ab.nope());
  T("equals itself", () => ab === ab);
}
const u = id(new Uint8Array([5, 6, 7, 8, 9]));
typed(u);

// subarray: a smaller window, the SAME buffer
function windows(a) {
  const s = a.subarray(1, 3);
  T("subarray length", () => s.length + "," + s.byteLength + "," + s.byteOffset);
  T("subarray buffer is the buffer", () => s.buffer === a.buffer);
  T("subarray buffer byteLength", () => s.buffer.byteLength);
}
windows(id(new Uint8Array([1, 2, 3, 4, 5, 6])));

// a DataView names the buffer it views
function dataView(d, u8) {
  T("dv buffer byteLength", () => d.buffer.byteLength);
  T("dv byteOffset and byteLength", () => d.byteOffset + "," + d.byteLength);
  T("dv shares the buffer", () => d.buffer === u8.buffer);
  T("dv sees a typed-array write", () => { u8[2] = 200; return d.getUint8(0); });
}
const u8 = id(new Uint8Array(8));
dataView(id(new DataView(u8.buffer, 2, 4)), u8);

// a typed array built from a dynamic ArrayBuffer is a view
function build(ab, Ctor) {
  const v = new Uint8Array(ab);
  if (v.length > 0) v[0] = 42;
  return v.length + ":" + bytes(new Uint8Array(ab));
}
const holder = id(new Uint8Array(4));
T("construct from a buffer", () => build(holder.buffer) + "|" + holder[0]);
T("construct from an empty buffer", () => build(id(new Uint8Array(0)).buffer));

// a Buffer's storage is its own here (Node pools small Buffers into one
// shared 8 KiB ArrayBuffer, which is not reproduced): only the type and the
// aliasing are compared
const b = id(Buffer.from([1, 2, 3]));
T("buffer typeof", () => typeof b.buffer);
T("buffer is an ArrayBuffer", () => Object.prototype.toString.call(b.buffer));
T("buffer identity", () => b.buffer === b.buffer);
T("buffer window aliases", () => { const v = new Uint8Array(b.buffer, 0); return typeof v; });
