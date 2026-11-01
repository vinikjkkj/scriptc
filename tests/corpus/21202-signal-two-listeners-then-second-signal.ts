// two listeners on INT, one on TERM, all in one batch
process.on("SIGINT", () => { console.log("I1"); process.nextTick(() => console.log("I1 tick")); Promise.resolve().then(() => console.log("I1 job")); });
process.on("SIGINT", () => { console.log("I2"); process.nextTick(() => console.log("I2 tick")); Promise.resolve().then(() => console.log("I2 job")); });
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
