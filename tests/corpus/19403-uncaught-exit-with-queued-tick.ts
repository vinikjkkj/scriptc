// @exit: 1
// A queued process.nextTick at a top-level throw: Node exits 1 and never runs it.
process.nextTick(() => console.log("tick"));
console.log("sync");
throw new Error("boom");
