// A process whose only timer is unref'd exits without firing it, through an untyped handle.
function park(h) { h.unref(); return h; }
park(setTimeout(() => console.log("must not fire"), 300));
console.log("main done");
