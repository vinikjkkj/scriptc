// String.fromCharCode.apply, Array.prototype.push.apply and Math.max.apply over run-time arrays in a JavaScript source answer like Node.
var chunk = [72, 105, 33];
console.log(String.fromCharCode.apply(String, chunk));
var parts = [];
parts.push(String.fromCharCode.apply(null, chunk.slice(0, 2)));
console.log(parts.join());
var a = [1]; var b = [2, 3];
Array.prototype.push.apply(a, b);
console.log(a.join(), Math.max.apply(null, [4, 9, 2]), Math.min.apply(Math, b));
