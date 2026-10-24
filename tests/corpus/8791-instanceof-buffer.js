"use strict";
// `x instanceof Buffer`, the test ioredis asks of every command argument: over an
// untyped value (a Buffer, a plain Uint8Array, a string, a number, an object, null,
// undefined), over a string|Buffer union, and over a Buffer-typed value.
function isBuf(x) {
  return x instanceof Buffer;
}
const buf = Buffer.from("abc");
const u8 = new Uint8Array([1, 2, 3]);
console.log(isBuf(buf), isBuf(u8), isBuf("abc"), isBuf(7), isBuf({ a: 1 }), isBuf(null), isBuf(undefined), isBuf([1, 2]));

/** @param {string | Buffer} arg */
function byteCount(arg) {
  if (arg instanceof Buffer) return "buffer:" + arg.length;
  return "string:" + Buffer.byteLength(arg);
}
console.log(byteCount(buf), byteCount("héllo"));

function describe(args) {
  let n = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] instanceof Buffer) n++;
  }
  return n;
}
console.log(describe([buf, "x", Buffer.alloc(2), u8, 4]));

const typed = Buffer.alloc(4);
console.log(typed instanceof Buffer, typed instanceof Uint8Array, u8 instanceof Buffer);
