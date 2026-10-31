// An ES-module entry that throws synchronously at top level, with an
// 'uncaughtException' listener. Node evaluates the entry inside a promise
// job, so the job queued before the throw runs BEFORE the listener; the
// listener gets (error, "unhandledRejection"); the queued tick and the
// immediate run after it, and the process exits 0.
process.on("uncaughtException", (e, origin) => console.log("caught", e.message, origin));
console.log("sync");
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("micro"));
setImmediate(() => console.log("immediate"));
throw new Error("boom");
