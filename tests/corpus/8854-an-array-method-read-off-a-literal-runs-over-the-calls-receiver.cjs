'use strict';
// `[].slice.call(x)`: the method read off an array literal is Array.prototype's, so the receiver
// is the call's. Over an untyped value, an `arguments` pack, and `.apply`.
function f(a) { return [].slice.call(a); }
console.log(f([1, 2, 3]), f([]));
function g(a) { return [].join.call(a, '-'); }
console.log(g(['a', 'b']));
function h(s) { return [].indexOf.call(s, 'b') + ':' + [].slice.apply(s, [1]); }
console.log(h(['a', 'b', 'c']));
