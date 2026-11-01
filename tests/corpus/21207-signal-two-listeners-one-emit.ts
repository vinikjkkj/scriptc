// two listeners on ONE signal, delivered once
process.on("SIGINT", () => { console.log("L1"); process.nextTick(() => console.log("L1 tick")); Promise.resolve().then(() => console.log("L1 job")); });
process.on("SIGINT", () => { console.log("L2"); process.nextTick(() => console.log("L2 tick")); Promise.resolve().then(() => console.log("L2 job")); });
setTimeout(() => { process.kill(process.pid, "SIGINT"); }, 10);
setTimeout(() => { console.log("done"); }, 200);
