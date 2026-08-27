// The back-edge binding `a` is read at b.js's TOP LEVEL, during the
// window where Node's `a` is still the partial exports object. Node
// prints `typeof a.aye undefined` there — `exports.aye = aye` has not run
// yet — while the require-as-alias lowering resolves the name to a's
// hoisted declaration and would print `function`. A silent wrong answer
// at exit 0, so the cycle keeps the fence and the message names the read.
// Hoisting is the trap: `aye` IS hoisted, but the EXPORT of it is an
// ordinary assignment below the require.
'use strict';
const a = require('./a.js');
console.log('aye(5) ' + a.aye(5));
