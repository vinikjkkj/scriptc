// A method read off an instance through an untyped value is the class's function,
// not one bound to that instance: the receiver is whatever the call supplies
// (`f.call(y)`), a plain call has none (TypeError, as `this.x` of undefined is in
// Node), and two reads of one method are one function. It was bound to the
// instance it was read from, so all three answered differently.
'use strict';
class R { constructor(t) { this.tag = t; } get1() { return this.tag; } }
const r1 = new R('one'), r2 = new R('two');
function viaAny(x, y) {
  const f = x.get1;
  const out = [typeof f];
  out.push(String(f.call(y)));
  try { out.push(String(f())); } catch (e) { out.push('threw ' + e.name); }
  out.push(String(f === y.get1));
  return out;
}
console.log(viaAny(r1, r2));

// An own property that shadows a method with a sibling method (pg's parseRow):
// the same unbound function.
class Result2 {
  constructor(m, tag) {
    this.tag = tag;
    if (m === 'array') { this.parseRow = this._parseRowAsArray; }
  }
  _parseRowAsArray(r) { return [this.tag + ':' + r[0]]; }
  parseRow(r) { return { tag: this.tag, n: r.length }; }
}
const a = new Result2('array', 'A');
const b = new Result2('object', 'B');
function viaAnyShadow(x) {
  const f = x.parseRow;
  const out = [typeof f];
  out.push(JSON.stringify(f.call(x, ['q'])));
  out.push(JSON.stringify(f.apply(x, [['r']])));
  try { f(['z']); out.push('no throw'); } catch (e) { out.push(String(e instanceof TypeError)); out.push(e.name); }
  return out;
}
console.log(viaAnyShadow(a));
console.log(viaAnyShadow(b));
