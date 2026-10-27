// `setTimeout(...).unref()` produces a handle; the chain keeps the handle, so it can flow into an untyped slot.
function dyn(x) { return x; }
const h = dyn(setTimeout(() => console.log("never fires"), 5000).unref());
console.log("chained hasRef", h.hasRef());
const r = dyn(h).unref();
console.log("chain returns handle", r === h, typeof r.hasRef);
const r2 = r.ref().unref();
console.log("ref chain", h.hasRef(), r2.hasRef());
const arr = [h];
console.log("in array", dyn(arr[0]).hasRef());
const im = dyn(setImmediate(() => console.log("immediate runs")));
console.log("immediate chain", im.unref().hasRef());
