'use strict';
const h = require('./helpers.cjs');
console.log(h.fe('a'), h.twice(4), h.list.length);
console.log(h.fe(h.fe('b')), h.twice(h.twice(1)));
const again = h.fe;
console.log(again('c'), again === h.fe, typeof h.twice);
