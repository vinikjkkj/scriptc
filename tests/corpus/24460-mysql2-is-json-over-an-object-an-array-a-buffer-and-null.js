"use strict";
// mysql2's isJSON (lib/packets/encode_parameter.js) decides whether a prepared-statement parameter is sent as JSON text or as itself: a plain
// object and an array are JSON, a Buffer, a Uint8Array, a string and a number are not, and null throws at the member read.
function isJSON(value) {
  return Array.isArray(value) || value.constructor === Object || (typeof value.toJSON === "function" && !Buffer.isBuffer(value));
}
function ctorIsObject(value) { return value.constructor === Object; }
function ctorIsArray(value) { return value.constructor === Array; }
class K { constructor() { this.x = 1; } }
const items = [{ a: 1 }, [1, 2], Buffer.from([1]), new Uint8Array(1), "s", 5, new K(), Object.create(null), null];
const names = ["obj", "arr", "buf", "u8", "str", "num", "K", "nullproto", "null"];
for (let i = 0; i < items.length; i++) {
  const v = items[i];
  let line = names[i] + ":";
  try { line += " isObject=" + ctorIsObject(v) + " isArray=" + ctorIsArray(v) + " isJSON=" + isJSON(v); } catch (e) { line += " threw " + e.constructor.name; }
  console.log(line);
}
