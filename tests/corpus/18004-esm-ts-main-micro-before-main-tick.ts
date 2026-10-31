// An ES module entry (this file has an export) runs inside a promise job:
// the promise job queued by its body runs BEFORE the body's nextTick.
export {};
process.nextTick(() => console.log("main-tick"));
Promise.resolve().then(() => console.log("main-micro"));
console.log("sync");
