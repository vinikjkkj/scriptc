// A CommonJS entry runs its main body synchronously, with no promise job
// around it: the process.nextTick queued by the body drains BEFORE the
// promise job queued by the same body (Node's processTicksAndRejections).
process.nextTick(() => console.log("main-tick"));
Promise.resolve().then(() => console.log("main-micro"));
console.log("sync");
