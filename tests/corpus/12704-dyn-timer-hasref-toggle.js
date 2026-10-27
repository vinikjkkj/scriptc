// hasRef before and after unref/ref, read through an untyped binding.
function dyn(x) { return x; }
function state(h) { return h.hasRef(); }
const t = setTimeout(() => console.log("fired"), 20);
console.log("start", state(t));
dyn(t).unref();
console.log("after unref", state(dyn(t)));
const d = dyn(t);
d.ref();
console.log("after dyn ref", state(d));
d.unref();
console.log("after dyn unref", state(d));
const i = setImmediate(() => console.log("immediate"));
console.log("imm start", state(dyn(i)));
dyn(i).unref();
console.log("imm after unref", state(i));
dyn(i).ref();
console.log("imm after ref", state(dyn(i)));
