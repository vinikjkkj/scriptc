// An unref'd Immediate does not keep the process alive, through an untyped handle.
function dyn(x) { return x; }
const im = setImmediate(() => console.log("must not run"));
dyn(im).unref();
console.log("unref'd immediate, hasRef", dyn(im).hasRef());
