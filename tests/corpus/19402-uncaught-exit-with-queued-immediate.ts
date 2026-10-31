// @exit: 1
// A queued setImmediate at a top-level throw: Node exits 1 and never runs it.
setImmediate(() => console.log("immediate"));
console.log("sync");
throw new Error("boom");
