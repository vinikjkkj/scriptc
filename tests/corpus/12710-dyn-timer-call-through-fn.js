// A handle that round-trips through an untyped function result keeps its methods.
function pass(x) { return x; }
const t = pass(setTimeout(() => console.log("must not fire"), 1000));
console.log("through fn hasRef", t.hasRef());
console.log("through fn unref", t.unref().hasRef());
const obj = { h: pass(setInterval(() => {}, 1000)) };
console.log("record field", obj.h.hasRef(), typeof obj.h.unref);
clearInterval(obj.h);
clearTimeout(t);
