// An unhandled promise rejection with no 'unhandledRejection' listener but an
// 'uncaughtException' listener: Node hands the reason to the uncaught listener
// with origin "unhandledRejection" after the tick, and the process exits 0.
process.on("uncaughtException", (e, origin) => console.log("caught", e.message, origin));
process.nextTick(() => console.log("tick"));
Promise.reject(new Error("rej"));
console.log("sync");
