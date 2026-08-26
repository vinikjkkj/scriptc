// The other half: a write that is lexically ABOVE nothing at all -- it
// sits inside a function body, so it can run at any later time whatever
// its position. Node answers 1 twice; the reference would answer 1 then 2.
'use strict';
let n = 1;
function bump() { n = 2; }
module.exports = { n, bump };
