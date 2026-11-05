// Symbol-keyed own properties on a Buffer and a Uint8Array: read, in, hasOwn, defineProperty, delete, spread, inspect (both forms) and deepStrictEqual.
"use strict";
const k = Symbol("k");
const h = Symbol("h");
function tag(b, v) { b[k] = v; Object.defineProperty(b, h, { value: 9 }); return b; }
function read(b) { return [b[k], b[h], k in b, Object.hasOwn(b, k), Object.getOwnPropertySymbols(b).length]; }
const buf = tag(Buffer.from([1, 2]), 5);
const u8 = tag(new Uint8Array(2), 6);
const empty = tag(Buffer.alloc(0), 7);
console.log(read(buf), read(u8), read(empty), read(Buffer.alloc(1)));
console.log(buf, u8, empty);
const copy = { ...buf };
console.log(Object.getOwnPropertySymbols(copy).length, delete buf[k], read(buf));
const assert = require("node:assert");
const a = tag(Buffer.from([1]), 1), b = tag(Buffer.from([1]), 2);
try { assert.deepStrictEqual(a, b); console.log("equal"); } catch (e) { console.log("differ"); }
b[k] = 1;
try { assert.deepStrictEqual(a, b); console.log("equal"); } catch (e) { console.log("differ"); }
