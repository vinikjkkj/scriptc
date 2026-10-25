// A destructured alias of an object literal: the binding is the value, and writes reach it.
const holder = {};
const { x } = { x: holder };
x.o = function (v) { return 'obj:' + v; };
console.log(x.o(1), holder.o(2));
