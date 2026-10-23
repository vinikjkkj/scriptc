// String.prototype.substr (Annex B), over a statically typed string and over an
// untyped parameter (a dynamic receiver, postgres-array's source.substr(position - 1)).
'use strict';
const s = 'hello world';
console.log(s.substr(3), '|', s.substr(-5, 3), '|', s.substr(2, 100), '|', s.substr(20), '|', s.substr(1, -1), '|', s.substr(NaN, 2), '|', s.substr(-100, 4), '|', s.substr(0, NaN), '|', s.substr(0));
const e = 'a\u{1F600}béc';
console.log(e.substr(1, 2).length, e.substr(3), e.substr(-3, 2), e.substr(1.9, 1.9));
function viaParam(x, n, m) {
  return [x.substr(1, 3), x.substr(-2), x.substr(n), x.substr(n, m), x.substr(0)].join('|');
}
console.log(viaParam('abcdef', 4, 1));
console.log(viaParam('abcdef', -3, 2));
console.log(viaParam('', 0, 0));
class P {
  constructor(source) { this.source = source; this.position = 3; }
  tail() { return this.source.substr(this.position - 1); }
}
console.log(new P('{a,{b}}').tail());
