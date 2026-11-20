// A hoisted JavaScript alias of an Array.prototype method (var slice = Array.prototype.slice) borrows through .call over arguments, strings and array-likes like Node.
var slice = Array.prototype.slice;
var forEach = Array.prototype.forEach;
var map = Array.prototype.map;
var indexOf = Array.prototype.indexOf;
function f() { return slice.call(arguments, 1); }
console.log(f(1, 2, 3).join());
var out = [];
forEach.call("ab", function (c) { out.push(c); });
console.log(out.join());
console.log(map.call({ length: 2, 0: 1, 1: 2 }, function (x) { return x * 3; }).join(), indexOf.call("hello", "l"));
function g(a) { return slice.call(a); }
console.log(g([1, 2]).length, g("xyz").join(""));
