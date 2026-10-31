// @exit: 1
// A throw at top level with a timer still armed: Node exits 1 and drops the
// timer unfired. The RC audit must not count the abandoned timer as a leak.
setTimeout(() => console.log("timer"), 10);
console.log("sync");
throw new Error("boom");
