'use strict';
// mysql2's getBinaryParser shape: an untyped factory returning a class that
// closes over its arguments and an inner function declaration.
function getParser(fields, options, config) {
  function readCode(field, n) {
    return field + '!' + n;
  }
  return class BinaryRow {
    constructor() {}
    next(packet, rows) {
      const out = [];
      for (let i = 0; i < fields.length; i++) {
        out.push(readCode(packet, i) + config.x + (options.flag ? 'F' : 'f'));
      }
      return out.join(',') + rows.length;
    }
  };
}
const P = getParser([1, 2], { flag: true }, { x: 'cfg' });
const Q = getParser([1], {}, { x: 'q' });
console.log(new P().next('p', [1]));
console.log(new Q().next('p', [1, 2]));
console.log(P === Q, new P() instanceof P, new P() instanceof Q, P.name);
