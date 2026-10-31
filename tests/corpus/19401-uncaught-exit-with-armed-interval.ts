// @exit: 1
// An interval still armed at a top-level throw: Node exits 1 with it unfired.
setInterval(() => console.log("interval"), 5);
console.log("sync");
throw new Error("boom");
