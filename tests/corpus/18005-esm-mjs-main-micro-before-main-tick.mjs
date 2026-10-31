// An .mjs entry is an ES module: the promise job queued by its body runs
// BEFORE the body's nextTick, the reverse of a CommonJS entry.
process.nextTick(() => console.log("main-tick"));
Promise.resolve().then(() => console.log("main-micro"));
console.log("sync");
