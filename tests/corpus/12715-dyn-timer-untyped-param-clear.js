// An untyped handle passed to clearTimeout from a helper, after the handle was unref'd.
function cancel(h) { clearTimeout(h); return h.hasRef(); }
const t = setTimeout(() => console.log("must not fire"), 10);
t.unref();
console.log("cancel reports", cancel(t));
setTimeout(() => console.log("tail"), 20);
