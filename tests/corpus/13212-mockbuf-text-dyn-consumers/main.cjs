'use strict';
// TextDecoder.decode and TextEncoder.encodeInto over checked-dynamic values. The mysql2 shape comes first: an own write over every Buffer.prototype name, then subarray into decode, which makes the subarray result dynamic.
const noop = function () {};
const r = Buffer.alloc(0);
for (const op in require('buffer').Buffer.prototype) {
  if (typeof r[op] === 'function') r[op] = noop;
}
const b = Buffer.from('hello');
const raw = b.subarray(1, 4);
console.log(new TextDecoder().decode(raw));
const t = (f) => { try { console.log(JSON.stringify(f())); } catch (e) { console.log(e.name, e.code, JSON.stringify(e.message)); } };
const obj = JSON.parse('{"a":1}');
const missing = JSON.parse('{"a":1}').nope;
const list = JSON.parse('[1,2]');
const nul = JSON.parse('null');
t(() => new TextDecoder().decode(missing));
t(() => new TextDecoder().decode(obj));
t(() => new TextDecoder().decode(nul));
t(() => new TextDecoder().decode(list));
const dest = b.subarray(0, 4);
const res = new TextEncoder().encodeInto('hé', dest);
console.log(res.read, res.written, dest[0], dest[1], dest[2]);
t(() => new TextEncoder().encodeInto('ab', obj));
t(() => new TextEncoder().encodeInto('ab', list));
