// the same signal delivered twice in one batch
process.on("SIGINT", () => { console.log("I"); process.nextTick(() => console.log("I tick")); Promise.resolve().then(() => console.log("I job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGINT"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
