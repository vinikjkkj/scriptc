// @exit: 1
// A module with top-level await that throws synchronously before its first
// await, with NO listener: the queued job runs, then the process exits 1.
console.log("sync");
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("micro"));
throw new Error("boom");
await 1;
