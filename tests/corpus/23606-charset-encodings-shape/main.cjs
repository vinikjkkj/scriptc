'use strict';
const CharsetToEncoding = require('./table.cjs');

console.log(CharsetToEncoding.length, CharsetToEncoding[5], CharsetToEncoding[21], CharsetToEncoding[63]);
console.log(CharsetToEncoding[10] === undefined, CharsetToEncoding[100] === undefined, CharsetToEncoding[20] === undefined);
console.log(8 in CharsetToEncoding, 19 in CharsetToEncoding, 20 in CharsetToEncoding, 24 in CharsetToEncoding, 64 in CharsetToEncoding);
console.log(CharsetToEncoding);
let present = 0;
CharsetToEncoding.forEach(() => { present++; });
console.log(present, Object.keys(CharsetToEncoding).length);
function charsetEncoding(id) {
  const enc = CharsetToEncoding[id];
  return enc === undefined ? 'binary' : enc;
}
console.log(charsetEncoding(1), charsetEncoding(12), charsetEncoding(31), charsetEncoding(999));
