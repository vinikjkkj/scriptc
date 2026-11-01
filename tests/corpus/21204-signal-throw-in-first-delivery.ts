// the first delivered signal's listener throws after scheduling a tick; second signal in the batch
process.on("SIGINT", () => { console.log("I"); process.nextTick(() => console.log("I tick")); throw new Error("boom"); });
process.on("SIGTERM", () => { console.log("T"); process.nextTick(() => console.log("T tick")); Promise.resolve().then(() => console.log("T job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); process.kill(process.pid, "SIGTERM"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
