// two signals (INT then TERM) delivered in one batch, one listener each
process.on("SIGINT", () => { console.log("I"); process.nextTick(() => console.log("I tick")); Promise.resolve().then(() => console.log("I job")); });
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
