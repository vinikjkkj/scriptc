// Array.prototype.<m>.apply in JavaScript with a run-time list: arguments objects, hoisted aliases, an instance-read method.
var a = [1, 2];
var b = [3, 4, 5];
Array.prototype.push.apply(a, b);
var slice = Array.prototype.slice;
function toArr(x) { return slice.apply(x, [0]); }
console.log(a, toArr(b), Math.max.apply(Math, a));
function wrap() { return Array.prototype.slice.apply(arguments, [1]); }
console.log(wrap(1, 2, 3));
function wrap2() { var args = arguments; return Array.prototype.concat.apply([], args); }
console.log(wrap2([1], [2, 3]));
a.push.apply(a, b);
console.log(a);
