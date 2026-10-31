// @exit: 1
// An ES-module entry that throws synchronously at top level with NO listener:
// the job queued before the throw runs, then the process exits 1. The queued
// tick and immediate never run.
console.log("sync");
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("micro"));
setImmediate(() => console.log("immediate"));
throw new Error("boom");
