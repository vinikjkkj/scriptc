// An ES-module entry with only a queued tick (no promise job, no timer) that
// throws synchronously with an 'uncaughtException' listener: the listener
// runs first, then the tick, and the process exits 0.
process.on("uncaughtException", (e) => console.log("caught", e.message));
process.nextTick(() => console.log("tick"));
throw new Error("boom");
