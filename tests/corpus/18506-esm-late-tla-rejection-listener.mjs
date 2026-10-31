// A module whose top-level await rejects after a timer: the rejection reaches
// the 'uncaughtException' listener with origin "unhandledRejection", the loop
// goes on, and the 'exit' listener sees status 0.
process.on("uncaughtException", (e, origin) => console.log("caught", e.message, origin));
process.on("exit", (code) => console.log("exit", code));
console.log("sync");
await new Promise((resolve) => setTimeout(resolve, 5));
throw new Error("late");
