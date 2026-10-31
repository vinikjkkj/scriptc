// A CommonJS main body that throws with an 'uncaughtException' listener:
// the listener runs synchronously, before the body's queued tick and job,
// and the loop then drains the tick before the job.
process.on("uncaughtException", (e) => console.log("caught", e.message));
process.nextTick(() => console.log("main-tick"));
Promise.resolve().then(() => console.log("main-micro"));
console.log("sync");
throw new Error("boom");
