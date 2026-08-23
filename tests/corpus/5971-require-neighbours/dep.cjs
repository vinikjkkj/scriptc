// The required module. Its body prints so the ORDER and the once-only
// evaluation are observable from the requiring side.
'use strict';
console.log('dep body');
module.exports = { n: 7, tag: 'from-dep' };
