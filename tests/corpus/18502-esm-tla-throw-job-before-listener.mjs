// A module with top-level await that throws synchronously before its first
// await, with an 'uncaughtException' listener: the queued job runs before the
// listener, the tick after it, and the module-level await never resumes.
process.on("uncaughtException", (e, origin) => console.log("caught", e.message, origin));
console.log("sync");
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("micro"));
throw new Error("boom");
await 1;
console.log("after await");
