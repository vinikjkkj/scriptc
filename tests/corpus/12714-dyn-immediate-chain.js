// Immediate methods chain and read through an untyped handle.
function dyn(x) { return x; }
const im = setImmediate(() => console.log("immediate ran"));
const d = dyn(im);
const same = d.unref();
console.log("unref returns same", same === d, same.hasRef());
same.ref();
console.log("ref restores", d.hasRef());
