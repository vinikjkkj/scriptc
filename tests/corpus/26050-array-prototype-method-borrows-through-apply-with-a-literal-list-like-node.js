// Array.prototype method borrows through .apply with a literal argument list (direct and aliased) answer like Node.
var slice = Array.prototype.slice;
var push = Array.prototype.push;
function f() { return slice.apply(arguments, [1]); }
function g() { return slice.apply(arguments); }
console.log(f(1, 2, 3).join(), g(4, 5).join(), Array.prototype.slice.apply([7, 8, 9], [1, 2]).join());
var a = [1];
push.apply(a, [2, 3]);
console.log(a.join());
